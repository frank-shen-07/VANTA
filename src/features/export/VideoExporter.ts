/**
 * ExportController implementation:
 * RendererHandle canvas → captureStream(fps) (+ cloned audio track from the
 * AudioController's recording stream) → MediaRecorder → Blob → download.
 */
import type { ExportController, ExportState, RecordingFormat, RecordingOptions, RecordingResult } from "@/shared/export/contract";
import { getAudioController, getRenderer } from "@/shared/runtime/registry";
import { useSceneStore } from "@/store/sceneStore";
import { clampBitrate, clampMaxDuration, exportFileName, pickFormat, supportedFormats } from "./recorder";

const ELAPSED_INTERVAL_MS = 250;
const TIMESLICE_MS = 1000;

export const INITIAL_EXPORT_STATE: ExportState = Object.freeze({
  status: "idle",
  elapsedMs: 0,
  error: null,
  result: null,
  audioNote: null,
}) as ExportState;

interface Session {
  recorder: MediaRecorder;
  chunks: Blob[];
  ownedTracks: MediaStreamTrack[];
  format: RecordingFormat;
  hasAudio: boolean;
  fileName: string;
  startedAt: number;
  elapsedTimer: ReturnType<typeof setInterval> | null;
  stopTimer: ReturnType<typeof setTimeout> | null;
  cancelled: boolean;
  done: Promise<RecordingResult>;
  resolve: (result: RecordingResult) => void;
  reject: (error: Error) => void;
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function triggerDownload(url: string, fileName: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Explains why the current audio source can't be recorded (null when it can). */
export function audioUnavailableReason(): string | null {
  const audio = getAudioController();
  if (!audio) return "The audio engine isn't running.";
  const { source } = audio.getState();
  if (!source) return "No audio source is loaded — the video will be silent.";
  if (source.analysis === "unavailable") {
    return source.kind === "soundcloud"
      ? "SoundCloud plays through its embed widget and can't be recorded."
      : "This audio URL blocks cross-origin access, so it can't be recorded.";
  }
  if (!audio.getRecordingStream()) return "Audio capture isn't available in this browser.";
  return null;
}

export class VideoExporter implements ExportController {
  private state: ExportState = INITIAL_EXPORT_STATE;
  private readonly listeners = new Set<(state: ExportState) => void>();
  private session: Session | null = null;
  private disposed = false;

  isSupported(): boolean {
    return (
      typeof window !== "undefined" &&
      typeof MediaRecorder !== "undefined" &&
      typeof HTMLCanvasElement !== "undefined" &&
      typeof HTMLCanvasElement.prototype.captureStream === "function" &&
      supportedFormats(this.isTypeSupported).length > 0
    );
  }

  private isTypeSupported = (mimeType: string): boolean =>
    typeof MediaRecorder !== "undefined" && typeof MediaRecorder.isTypeSupported === "function" && MediaRecorder.isTypeSupported(mimeType);

  getSupportedFormats(): RecordingFormat[] {
    return supportedFormats(typeof MediaRecorder !== "undefined" ? this.isTypeSupported : null);
  }

  getState(): ExportState {
    return this.state;
  }

  subscribe(listener: (state: ExportState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private setState(patch: Partial<ExportState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener(this.state);
  }

  private fail(message: string): never {
    this.setState({ status: "error", error: message, elapsedMs: 0 });
    throw new Error(message);
  }

  async start(options: RecordingOptions): Promise<void> {
    if (this.disposed) throw new Error("Exporter disposed.");
    const busy = this.state.status;
    if (busy === "preparing" || busy === "recording" || busy === "finalizing") throw new Error("A recording is already in progress.");
    if (!this.isSupported()) {
      return this.fail("Video recording isn't supported in this browser (needs MediaRecorder and canvas.captureStream). Try Chrome, Edge or Firefox.");
    }
    const renderer = getRenderer();
    if (!renderer) return this.fail("The 3D viewport isn't ready yet — there's nothing to record.");
    this.revokeResult();
    this.setState({ status: "preparing", elapsedMs: 0, error: null, result: null, audioNote: null });

    const format = pickFormat(this.isTypeSupported, options.formatId);
    if (!format) return this.fail("No supported video format was found in this browser.");
    const fps = options.fps === 24 || options.fps === 60 ? options.fps : 30;

    let canvasStream: MediaStream;
    try {
      const canvas = renderer.getCanvas();
      canvasStream = canvas.captureStream(fps);
    } catch {
      return this.fail("Couldn't capture the viewport canvas.");
    }
    const videoTrack = canvasStream.getVideoTracks()[0];
    if (!videoTrack) return this.fail("The viewport canvas produced no video track.");
    const ownedTracks: MediaStreamTrack[] = [videoTrack];

    let audioNote: string | null = null;
    let audioTrack: MediaStreamTrack | null = null;
    if (!options.includeAudio) {
      audioNote = "Audio was turned off for this recording.";
    } else if (!format.supportsAudio) {
      audioNote = "The selected format doesn't support audio.";
    } else {
      const reason = audioUnavailableReason();
      const shared = reason ? null : (getAudioController()?.getRecordingStream()?.getAudioTracks()[0] ?? null);
      if (shared && shared.readyState === "live") {
        // Clone so stopping our copy never ends the engine's shared destination track.
        audioTrack = shared.clone();
        ownedTracks.push(audioTrack);
      } else {
        audioNote = reason ?? "No live audio track is available.";
      }
    }

    const stream = new MediaStream(audioTrack ? [videoTrack, audioTrack] : [videoTrack]);
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, {
        mimeType: format.mimeType,
        videoBitsPerSecond: clampBitrate(options.videoBitsPerSecond),
        ...(audioTrack ? { audioBitsPerSecond: 160_000 } : {}),
      });
    } catch {
      ownedTracks.forEach((t) => t.stop());
      return this.fail(`This browser can't record ${format.label}. Choose another format.`);
    }

    let resolve!: (r: RecordingResult) => void;
    let reject!: (e: Error) => void;
    const done = new Promise<RecordingResult>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    done.catch(() => {}); // auto-stop / cancel may never be awaited
    const sceneName = useSceneStore.getState().scene.name;
    const session: Session = {
      recorder,
      chunks: [],
      ownedTracks,
      format,
      hasAudio: !!audioTrack,
      fileName: exportFileName(sceneName, new Date(), format.extension),
      startedAt: now(),
      elapsedTimer: null,
      stopTimer: null,
      cancelled: false,
      done,
      resolve,
      reject,
    };
    this.session = session;

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) session.chunks.push(e.data);
    };
    recorder.onstop = () => this.finalize(session);
    recorder.onerror = () => {
      if (this.session !== session) return;
      session.cancelled = true;
      this.cleanupSession(session);
      session.reject(new Error("The recorder stopped unexpectedly."));
      this.setState({ status: "error", error: "The recorder stopped unexpectedly (encoder error).", elapsedMs: 0 });
    };

    try {
      recorder.start(TIMESLICE_MS);
    } catch {
      this.cleanupSession(session);
      return this.fail("The recorder failed to start.");
    }
    session.startedAt = now();
    session.elapsedTimer = setInterval(() => {
      if (this.session === session && this.state.status === "recording") this.setState({ elapsedMs: now() - session.startedAt });
    }, ELAPSED_INTERVAL_MS);
    session.stopTimer = setTimeout(() => {
      if (this.session === session) void this.stop().catch(() => {});
    }, clampMaxDuration(options.maxDurationSec) * 1000);
    this.setState({ status: "recording", elapsedMs: 0, audioNote });
  }

  stop(): Promise<RecordingResult> {
    const session = this.session;
    if (!session || session.cancelled) return Promise.reject(new Error("Not recording."));
    if (session.recorder.state !== "inactive") {
      this.clearTimers(session);
      this.setState({ status: "finalizing", elapsedMs: now() - session.startedAt });
      try {
        session.recorder.requestData();
      } catch {
        /* ignore */
      }
      session.recorder.stop();
    }
    return session.done;
  }

  private finalize(session: Session): void {
    if (this.session !== session) return;
    this.session = null;
    const durationMs = now() - session.startedAt;
    this.cleanupSession(session);
    if (session.cancelled) {
      session.reject(new Error("Recording cancelled."));
      return;
    }
    const type = session.recorder.mimeType || session.format.mimeType;
    const blob = new Blob(session.chunks, { type });
    if (blob.size === 0) {
      const message = "The recording is empty — the viewport produced no frames.";
      session.reject(new Error(message));
      this.setState({ status: "error", error: message, elapsedMs: 0 });
      return;
    }
    const result: RecordingResult = {
      blob,
      url: URL.createObjectURL(blob),
      mimeType: type,
      fileName: session.fileName,
      durationMs,
      sizeBytes: blob.size,
      hasAudio: session.hasAudio,
    };
    this.setState({ status: "ready", elapsedMs: durationMs, result, error: null });
    session.resolve(result);
  }

  private clearTimers(session: Session): void {
    if (session.elapsedTimer) clearInterval(session.elapsedTimer);
    if (session.stopTimer) clearTimeout(session.stopTimer);
    session.elapsedTimer = session.stopTimer = null;
  }

  private cleanupSession(session: Session): void {
    this.clearTimers(session);
    for (const track of session.ownedTracks) track.stop();
    session.ownedTracks = [];
    if (this.session === session) this.session = null;
  }

  cancel(): void {
    const session = this.session;
    if (!session) return;
    session.cancelled = true;
    this.session = null;
    this.clearTimers(session);
    try {
      if (session.recorder.state !== "inactive") session.recorder.stop();
    } catch {
      /* ignore */
    }
    this.cleanupSession(session);
    session.chunks = [];
    session.reject(new Error("Recording cancelled."));
    this.setState({ status: "idle", elapsedMs: 0, error: null, audioNote: null });
  }

  download(result?: RecordingResult): void {
    const r = result ?? this.state.result;
    if (!r) return;
    triggerDownload(r.url, r.fileName);
  }

  private revokeResult(): void {
    const result = this.state.result;
    if (result) URL.revokeObjectURL(result.url);
  }

  discard(): void {
    if (this.session) this.cancel();
    this.revokeResult();
    this.setState({ status: "idle", elapsedMs: 0, error: null, result: null, audioNote: null });
  }

  async downloadStill(): Promise<void> {
    const renderer = getRenderer();
    if (!renderer) {
      const message = "The 3D viewport isn't ready yet — there's nothing to capture.";
      this.setState({ error: message });
      throw new Error(message);
    }
    let blob: Blob;
    try {
      blob = await renderer.captureStill({ mimeType: "image/png" });
    } catch {
      const message = "Couldn't capture a still from the viewport.";
      this.setState({ error: message });
      throw new Error(message);
    }
    const url = URL.createObjectURL(blob);
    triggerDownload(url, exportFileName(useSceneStore.getState().scene.name, new Date(), "png"));
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    if (this.state.error) this.setState({ error: null });
  }

  /** Clears an error shown in the UI. */
  clearError(): void {
    if (this.state.status === "error") this.setState({ status: this.state.result ? "ready" : "idle", error: null });
    else if (this.state.error) this.setState({ error: null });
  }

  dispose(): void {
    if (this.disposed) return;
    this.cancel();
    this.revokeResult();
    this.disposed = true;
    this.listeners.clear();
  }
}

export function isVideoExporter(value: unknown): value is VideoExporter {
  return value instanceof VideoExporter;
}

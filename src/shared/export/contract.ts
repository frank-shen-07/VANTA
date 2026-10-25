/**
 * EXPORT CONTRACT — owned by the lead orchestrator, implemented by Agent 2.
 *
 * Pipeline: RendererHandle.getCanvas() → canvas.captureStream(fps) →
 * (+ AudioController.getRecordingStream() audio track when authorised and
 * available) → MediaRecorder → Blob → download.
 */

export type VideoContainer = "webm" | "mp4";

export interface RecordingFormat {
  /** Stable id, e.g. "webm-vp9-opus". */
  id: string;
  label: string;
  /** Exact mimeType passed to MediaRecorder (verified with isTypeSupported). */
  mimeType: string;
  container: VideoContainer;
  extension: "webm" | "mp4";
  supportsAudio: boolean;
}

export interface RecordingOptions {
  /** One of getSupportedFormats(); defaults to the best supported WebM. */
  formatId?: string;
  fps: 24 | 30 | 60;
  /** 1_000_000 .. 40_000_000 */
  videoBitsPerSecond: number;
  /** Include the currently playing audio when the source allows it. */
  includeAudio: boolean;
  /** Auto-stop after this many seconds (1..600). */
  maxDurationSec: number;
}

export const DEFAULT_RECORDING_OPTIONS: RecordingOptions = {
  fps: 30,
  videoBitsPerSecond: 8_000_000,
  includeAudio: true,
  maxDurationSec: 120,
};

export type RecordingStatus = "idle" | "preparing" | "recording" | "finalizing" | "ready" | "error";

export interface RecordingResult {
  blob: Blob;
  /** Object URL; revoked by discard() / the next recording. */
  url: string;
  mimeType: string;
  fileName: string;
  durationMs: number;
  sizeBytes: number;
  hasAudio: boolean;
}

export interface ExportState {
  status: RecordingStatus;
  /** Milliseconds recorded so far (updated ~4x/second while recording). */
  elapsedMs: number;
  error: string | null;
  result: RecordingResult | null;
  /** Why audio is not included, when it isn't (e.g. "SoundCloud is playback-only"). */
  audioNote: string | null;
}

export interface ExportController {
  isSupported(): boolean;
  getSupportedFormats(): RecordingFormat[];
  getState(): ExportState;
  subscribe(listener: (state: ExportState) => void): () => void;
  start(options: RecordingOptions): Promise<void>;
  stop(): Promise<RecordingResult>;
  cancel(): void;
  download(result?: RecordingResult): void;
  /** Revokes the result URL and returns to idle. */
  discard(): void;
  /** PNG still of the current frame, downloaded immediately. */
  downloadStill(): Promise<void>;
  dispose(): void;
}

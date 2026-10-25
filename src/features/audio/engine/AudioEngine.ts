/**
 * The single AudioController implementation.
 *
 * Web Audio graph (one lazily created AudioContext):
 *
 *   MediaElementSource ─┬─► monitorGain (volume/mute) ─► destination
 *                       └─► analysisBus ─┬─► AnalyserNode (fftSize 2048) ─► features
 *   MicrophoneSource ──────► analysisBus └─► MediaStreamAudioDestination (recording)
 *
 * Playback and analysis share the same source node; analysis is taken before
 * the volume stage, so the monitor volume never changes the visuals. The
 * microphone is analysed but never routed to the speakers. Playback-only
 * sources (SoundCloud widget, CORS-blocked URLs) never touch Web Audio and
 * keep the audio bus at silence.
 */
import {
  AudioProfileSchema,
  type AudioController,
  type AudioControllerState,
  type AudioFeatures,
  type AudioProfile,
  type AudioSourceInfo,
  type AudioSourceKind,
  type FeatureListener,
  type StateListener,
} from "@/shared/audio/contract";
import { audioBus, publishAudioFrame, resetAudioBus, setAnalysisActive, subscribeAudioFrames } from "@/shared/runtime/audioBus";
import { useSceneStore } from "@/store/sceneStore";
import { AudioAnalyzer, summarizeStats } from "./analysis";
import { loadSoundCloudApi, type SoundCloudWidget } from "./soundcloud";
import { isSoundCloudUrl, mediaErrorMessage, parseHttpUrl, soundCloudEmbedUrl, urlLabel, validateAudioFile } from "./validation";

export const FFT_SIZE = 2048;
const STATE_INTERVAL_MS = 100;
const FILE_LOAD_TIMEOUT_MS = 20000;
const URL_LOAD_TIMEOUT_MS = 20000;
const SOUNDCLOUD_READY_TIMEOUT_MS = 15000;

export const SOUNDCLOUD_ANALYSIS_NOTE =
  "SoundCloud plays through its official embed widget; its audio is not accessible to Web Audio, so visuals can't react to it.";
export const CORS_ANALYSIS_NOTE =
  "This server doesn't allow cross-origin (CORS) access, so the audio plays but can't be analysed. Visuals won't react.";

export const INITIAL_AUDIO_STATE: AudioControllerState = Object.freeze({
  status: "empty",
  source: null,
  currentTime: 0,
  duration: 0,
  isLive: false,
  volume: 0.8,
  muted: false,
  error: null,
}) as AudioControllerState;

interface ActiveSource {
  kind: AudioSourceKind;
  info: AudioSourceInfo;
  /** True when the source feeds the analyser. */
  analysed: boolean;
  element: HTMLAudioElement | null;
  node: AudioNode | null;
  objectUrl: string | null;
  stream: MediaStream | null;
  widget: SoundCloudWidget | null;
  iframe: HTMLIFrameElement | null;
  /** SoundCloud position cache (seconds). */
  position: number;
  /** Microphone paused (disconnected from the analysis bus). */
  suspended: boolean;
  cleanups: (() => void)[];
}

class SupersededError extends Error {
  constructor() {
    super("Superseded by a newer source");
  }
}

function finiteDuration(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function microphoneErrorMessage(error: unknown): string {
  const name = (error as { name?: string } | null)?.name;
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Microphone permission was denied. Allow microphone access for this site in your browser settings and try again.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No microphone was found. Connect an input device and try again.";
    case "NotReadableError":
      return "The microphone is busy or unavailable (another app may be using it).";
    case "AbortError":
      return "Microphone start was interrupted. Please try again.";
    default:
      return "Couldn't start the microphone.";
  }
}

export class AudioEngine implements AudioController {
  private ctx: AudioContext | null = null;
  private analysisBus: GainNode | null = null;
  private monitorGain: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private recordDest: MediaStreamAudioDestinationNode | null = null;
  private freqData: Float32Array<ArrayBuffer> = new Float32Array(FFT_SIZE / 2);
  private timeData: Float32Array<ArrayBuffer> = new Float32Array(FFT_SIZE);
  private readonly analyzer = new AudioAnalyzer(48000, FFT_SIZE);

  private current: ActiveSource | null = null;
  private loadToken = 0;
  private state: AudioControllerState = INITIAL_AUDIO_STATE;
  private readonly stateListeners = new Set<StateListener>();
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private raf = 0;
  private lastFrameMs = 0;
  private disposed = false;

  /* ------------------------------------------------------------------ */
  /* State                                                               */
  /* ------------------------------------------------------------------ */

  getState(): AudioControllerState {
    return this.state;
  }

  subscribeState(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  private setState(patch: Partial<AudioControllerState>): void {
    let changed = false;
    for (const key of Object.keys(patch) as (keyof AudioControllerState)[]) {
      if (this.state[key] !== patch[key]) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    this.state = { ...this.state, ...patch };
    for (const listener of this.stateListeners) listener(this.state);
  }

  /** Clears the current error message (UI dismiss). */
  clearError(): void {
    if (this.state.status === "error" && !this.current) this.setState({ status: "empty", error: null });
    else this.setState({ error: null });
  }

  /** Current playback position read directly from the source (for per-frame UI via refs). */
  getCurrentTime(): number {
    const src = this.current;
    if (!src) return 0;
    if (src.element) return src.element.currentTime;
    return src.position;
  }

  /* 10 Hz currentTime publisher while playing (never per frame). */
  private startTicker(): void {
    if (this.tickTimer) return;
    this.tickTimer = setInterval(() => {
      const src = this.current;
      if (!src || this.state.status !== "playing") return this.stopTicker();
      if (src.kind === "microphone") return;
      const t = this.getCurrentTime();
      if (Math.abs(t - this.state.currentTime) >= 0.05) this.setState({ currentTime: t });
    }, STATE_INTERVAL_MS);
  }

  private stopTicker(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.tickTimer = null;
  }

  /* ------------------------------------------------------------------ */
  /* Web Audio graph                                                     */
  /* ------------------------------------------------------------------ */

  private ensureContext(): AudioContext {
    if (this.ctx && this.ctx.state !== "closed") return this.ctx;
    const Ctor: typeof AudioContext | undefined =
      typeof window !== "undefined" ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) : undefined;
    if (!Ctor) throw new Error("This browser doesn't support the Web Audio API.");
    const ctx = new Ctor({ latencyHint: "interactive" });
    const analysisBus = ctx.createGain();
    const monitorGain = ctx.createGain();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    analyser.smoothingTimeConstant = 0;
    analyser.minDecibels = -120;
    analyser.maxDecibels = 0;
    analysisBus.connect(analyser);
    let recordDest: MediaStreamAudioDestinationNode | null = null;
    try {
      recordDest = ctx.createMediaStreamDestination();
      analysisBus.connect(recordDest);
    } catch {
      recordDest = null;
    }
    monitorGain.connect(ctx.destination);
    monitorGain.gain.value = this.state.muted ? 0 : this.state.volume;
    this.ctx = ctx;
    this.analysisBus = analysisBus;
    this.monitorGain = monitorGain;
    this.analyser = analyser;
    this.recordDest = recordDest;
    this.freqData = new Float32Array(analyser.frequencyBinCount);
    this.timeData = new Float32Array(analyser.fftSize);
    this.analyzer.configure(ctx.sampleRate, analyser.fftSize);
    return ctx;
  }

  private async resumeContext(): Promise<void> {
    const ctx = this.ctx;
    if (ctx && ctx.state === "suspended") {
      try {
        await ctx.resume();
      } catch {
        /* resumed on the next user gesture */
      }
    }
  }

  private applyVolume(): void {
    const { volume, muted } = this.state;
    const gain = muted ? 0 : volume;
    const src = this.current;
    if (this.monitorGain && this.ctx) this.monitorGain.gain.setTargetAtTime(gain, this.ctx.currentTime, 0.015);
    if (src && !src.analysed && src.element) {
      src.element.volume = volume;
      src.element.muted = muted;
    }
    if (src?.widget) src.widget.setVolume(Math.round(gain * 100));
  }

  /* ------------------------------------------------------------------ */
  /* Analysis loop                                                       */
  /* ------------------------------------------------------------------ */

  private isSourceRunning(src: ActiveSource): boolean {
    if (src.kind === "microphone") return !src.suspended;
    return !!src.element && !src.element.paused && !src.element.ended;
  }

  private startLoop(): void {
    if (this.raf || typeof requestAnimationFrame === "undefined") return;
    this.lastFrameMs = 0;
    this.raf = requestAnimationFrame(this.frame);
  }

  private stopLoop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private frame = (now: number): void => {
    this.raf = 0;
    const src = this.current;
    const analyser = this.analyser;
    if (!src || !src.analysed || !analyser || this.disposed) return;
    const dt = this.lastFrameMs ? Math.min(0.1, (now - this.lastFrameMs) / 1000) : 1 / 60;
    this.lastFrameMs = now;
    const active = this.isSourceRunning(src);
    if (active) {
      analyser.getFloatFrequencyData(this.freqData);
      analyser.getFloatTimeDomainData(this.timeData);
    }
    const release = useSceneStore.getState().scene.audio.smoothing;
    this.analyzer.process({ frequencyDb: this.freqData, timeDomain: this.timeData, dt, release, active, time: now / 1000 });
    publishAudioFrame(this.analyzer.features, this.analyzer.spectrum);
    if (active) {
      setAnalysisActive(true);
    } else if (this.analyzer.isSilent()) {
      resetAudioBus();
      return; // idle until playback resumes
    }
    this.raf = requestAnimationFrame(this.frame);
  };

  /* ------------------------------------------------------------------ */
  /* Source lifecycle                                                    */
  /* ------------------------------------------------------------------ */

  private newSource(kind: AudioSourceKind, info: AudioSourceInfo, analysed: boolean): ActiveSource {
    return { kind, info, analysed, element: null, node: null, objectUrl: null, stream: null, widget: null, iframe: null, position: 0, suspended: false, cleanups: [] };
  }

  private releaseSource(): void {
    const src = this.current;
    this.current = null;
    this.stopLoop();
    this.stopTicker();
    if (src) {
      for (const cleanup of src.cleanups.splice(0)) {
        try {
          cleanup();
        } catch {
          /* ignore */
        }
      }
      if (src.element) {
        try {
          src.element.pause();
          src.element.removeAttribute("src");
          src.element.load();
        } catch {
          /* ignore */
        }
      }
      try {
        src.node?.disconnect();
      } catch {
        /* ignore */
      }
      if (src.objectUrl) URL.revokeObjectURL(src.objectUrl);
      src.stream?.getTracks().forEach((t) => t.stop());
      if (src.widget) {
        try {
          src.widget.pause();
        } catch {
          /* ignore */
        }
      }
      src.iframe?.remove();
    }
    this.analyzer.reset();
    resetAudioBus();
  }

  private beginLoad(kind: AudioSourceKind, info: AudioSourceInfo): number {
    const token = ++this.loadToken;
    this.releaseSource();
    this.setState({ status: "loading", source: info, currentTime: 0, duration: 0, isLive: kind === "microphone", error: null });
    return token;
  }

  private fail(token: number, message: string): never {
    if (token === this.loadToken) {
      this.releaseSource();
      this.setState({ status: "error", source: null, currentTime: 0, duration: 0, isLive: false, error: message });
    }
    throw new Error(message);
  }

  private createElement(): HTMLAudioElement {
    const el = document.createElement("audio");
    el.preload = "auto";
    el.crossOrigin = null;
    (el as HTMLAudioElement & { disableRemotePlayback?: boolean }).disableRemotePlayback = true;
    return el;
  }

  /** Resolves on loadedmetadata, rejects with the media error code on error / timeout. */
  private waitForMetadata(el: HTMLAudioElement, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      if (el.readyState >= 1) return resolve();
      const timer = setTimeout(() => done(new Error("timeout")), timeoutMs);
      const onMeta = () => done();
      const onError = () => done(Object.assign(new Error("media-error"), { code: el.error?.code }));
      function done(error?: Error) {
        clearTimeout(timer);
        el.removeEventListener("loadedmetadata", onMeta);
        el.removeEventListener("error", onError);
        if (error) reject(error);
        else resolve();
      }
      el.addEventListener("loadedmetadata", onMeta);
      el.addEventListener("error", onError);
    });
  }

  /** Wires element events → state for an active element source. */
  private attachElement(src: ActiveSource, context: "file" | "url"): void {
    const el = src.element!;
    const on = (type: string, fn: () => void) => {
      el.addEventListener(type, fn);
      src.cleanups.push(() => el.removeEventListener(type, fn));
    };
    on("play", () => {
      if (this.current !== src) return;
      this.setState({ status: "playing", error: null });
      this.startTicker();
      if (src.analysed) this.startLoop();
    });
    on("pause", () => {
      if (this.current !== src || el.ended) return;
      this.setState({ status: "paused", currentTime: el.currentTime });
    });
    on("ended", () => {
      if (this.current !== src) return;
      this.setState({ status: "ended", currentTime: el.duration || el.currentTime });
    });
    on("durationchange", () => {
      if (this.current === src) this.setState({ duration: finiteDuration(el.duration) });
    });
    on("seeked", () => {
      if (this.current === src) this.setState({ currentTime: el.currentTime });
    });
    on("error", () => {
      if (this.current !== src) return;
      const message = mediaErrorMessage(el.error?.code, context);
      this.releaseSource();
      this.setState({ status: "error", source: null, currentTime: 0, duration: 0, error: message });
    });
  }

  async loadFile(file: File): Promise<void> {
    this.assertAlive();
    const check = validateAudioFile(file);
    if (!check.ok) {
      // Keep the current source playing; just report the problem.
      this.setState({ error: check.error });
      throw new Error(check.error);
    }
    const info: AudioSourceInfo = { kind: "file", label: file.name, mimeType: check.mimeType, sizeBytes: file.size, analysis: "available" };
    const token = this.beginLoad("file", info);
    let ctx: AudioContext;
    try {
      ctx = this.ensureContext();
    } catch (e) {
      return this.fail(token, (e as Error).message);
    }
    void this.resumeContext();
    const src = this.newSource("file", info, true);
    const el = this.createElement();
    src.element = el;
    src.objectUrl = URL.createObjectURL(file);
    this.current = src;
    try {
      src.node = ctx.createMediaElementSource(el);
      src.node.connect(this.analysisBus!);
      src.node.connect(this.monitorGain!);
    } catch {
      return this.fail(token, "Couldn't connect the audio file to the analyser.");
    }
    el.src = src.objectUrl;
    try {
      await this.waitForMetadata(el, FILE_LOAD_TIMEOUT_MS);
    } catch (e) {
      if (token !== this.loadToken) return;
      const err = e as Error & { code?: number };
      return this.fail(token, err.message === "timeout" ? "Timed out while reading the audio file." : mediaErrorMessage(err.code, "file"));
    }
    if (token !== this.loadToken) return;
    this.attachElement(src, "file");
    this.applyVolume();
    this.setState({ status: "ready", duration: finiteDuration(el.duration), currentTime: 0, error: null });
  }

  async loadUrl(input: string): Promise<void> {
    this.assertAlive();
    const url = parseHttpUrl(input);
    if (!url) {
      const message = "Enter a valid http(s) link to an MP3 or WAV file.";
      this.setState({ error: message });
      throw new Error(message);
    }
    if (isSoundCloudUrl(url.href)) return this.loadSoundCloud(url.href);
    const info: AudioSourceInfo = { kind: "url", label: urlLabel(url), url: url.href, analysis: "available" };
    const token = this.beginLoad("url", info);
    let ctx: AudioContext;
    try {
      ctx = this.ensureContext();
    } catch (e) {
      return this.fail(token, (e as Error).message);
    }
    void this.resumeContext();

    // 1) CORS-enabled element → full Web Audio analysis.
    const corsEl = this.createElement();
    corsEl.crossOrigin = "anonymous";
    corsEl.src = url.href;
    let corsOk = false;
    let corsErrorCode: number | undefined;
    try {
      await this.waitForMetadata(corsEl, URL_LOAD_TIMEOUT_MS);
      corsOk = true;
    } catch (e) {
      corsErrorCode = (e as { code?: number }).code;
      corsEl.removeAttribute("src");
      corsEl.load();
    }
    if (token !== this.loadToken) return;

    if (corsOk) {
      const src = this.newSource("url", info, true);
      src.element = corsEl;
      this.current = src;
      try {
        src.node = ctx.createMediaElementSource(corsEl);
        src.node.connect(this.analysisBus!);
        src.node.connect(this.monitorGain!);
      } catch {
        return this.fail(token, "Couldn't connect the audio URL to the analyser.");
      }
      this.attachElement(src, "url");
      this.applyVolume();
      this.setState({ status: "ready", duration: finiteDuration(corsEl.duration), error: null });
      return;
    }

    // 2) Fallback: plain element, NOT connected to Web Audio → playback only.
    const plainEl = this.createElement();
    plainEl.src = url.href;
    try {
      await this.waitForMetadata(plainEl, URL_LOAD_TIMEOUT_MS);
    } catch (e) {
      plainEl.removeAttribute("src");
      plainEl.load();
      if (token !== this.loadToken) return;
      const err = e as Error & { code?: number };
      return this.fail(token, err.message === "timeout" ? "Timed out loading the audio URL." : mediaErrorMessage(err.code ?? corsErrorCode, "url"));
    }
    if (token !== this.loadToken) {
      plainEl.removeAttribute("src");
      plainEl.load();
      return;
    }
    const playbackInfo: AudioSourceInfo = { ...info, analysis: "unavailable", analysisNote: CORS_ANALYSIS_NOTE };
    const src = this.newSource("url", playbackInfo, false);
    src.element = plainEl;
    this.current = src;
    this.attachElement(src, "url");
    this.applyVolume();
    resetAudioBus();
    this.setState({ status: "ready", source: playbackInfo, duration: finiteDuration(plainEl.duration), error: null });
  }

  async startMicrophone(): Promise<void> {
    this.assertAlive();
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      const message = "Microphone input needs a secure context (HTTPS or localhost) and a supporting browser.";
      this.setState({ error: message });
      throw new Error(message);
    }
    const info: AudioSourceInfo = { kind: "microphone", label: "Microphone", analysis: "available" };
    const token = this.beginLoad("microphone", info);
    let ctx: AudioContext;
    try {
      ctx = this.ensureContext();
    } catch (e) {
      return this.fail(token, (e as Error).message);
    }
    const resumed = this.resumeContext();
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        video: false,
      });
    } catch (e) {
      return this.fail(token, microphoneErrorMessage(e));
    }
    if (token !== this.loadToken) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    await resumed;
    const track = stream.getAudioTracks()[0];
    const label = track?.label ? `Mic · ${track.label}`.slice(0, 80) : "Microphone";
    const liveInfo: AudioSourceInfo = { ...info, label };
    const src = this.newSource("microphone", liveInfo, true);
    src.stream = stream;
    this.current = src;
    try {
      src.node = ctx.createMediaStreamSource(stream);
      src.node.connect(this.analysisBus!); // analysed + recordable, never monitored
    } catch {
      return this.fail(token, "Couldn't connect the microphone to the analyser.");
    }
    if (track) {
      const onEnded = () => {
        if (this.current !== src) return;
        this.releaseSource();
        this.setState({ status: "error", source: null, isLive: false, error: "The microphone was disconnected." });
      };
      track.addEventListener("ended", onEnded);
      src.cleanups.push(() => track.removeEventListener("ended", onEnded));
    }
    this.setState({ status: "playing", source: liveInfo, isLive: true, duration: 0, currentTime: 0, error: null });
    this.startLoop();
  }

  async loadSoundCloud(input: string): Promise<void> {
    this.assertAlive();
    const url = parseHttpUrl(input);
    if (!url || !isSoundCloudUrl(url.href)) {
      const message = "Enter a SoundCloud track or playlist link (https://soundcloud.com/…).";
      this.setState({ error: message });
      throw new Error(message);
    }
    const info: AudioSourceInfo = {
      kind: "soundcloud",
      label: urlLabel(url),
      url: url.href,
      analysis: "unavailable",
      analysisNote: SOUNDCLOUD_ANALYSIS_NOTE,
    };
    const token = this.beginLoad("soundcloud", info);
    resetAudioBus();
    let api: Awaited<ReturnType<typeof loadSoundCloudApi>>;
    try {
      api = await loadSoundCloudApi();
    } catch (e) {
      return this.fail(token, (e as Error).message);
    }
    if (token !== this.loadToken) return;
    const iframe = document.createElement("iframe");
    iframe.title = "SoundCloud player";
    iframe.allow = "autoplay; encrypted-media";
    iframe.src = soundCloudEmbedUrl(url.href);
    iframe.setAttribute("aria-hidden", "true");
    iframe.tabIndex = -1;
    Object.assign(iframe.style, { position: "fixed", left: "-10000px", top: "0", width: "320px", height: "166px", border: "0", opacity: "0", pointerEvents: "none" });
    document.body.appendChild(iframe);
    const src = this.newSource("soundcloud", info, false);
    src.iframe = iframe;
    this.current = src;
    let widget: SoundCloudWidget;
    try {
      widget = api.Widget(iframe);
    } catch {
      return this.fail(token, "Couldn't start the SoundCloud widget.");
    }
    src.widget = widget;
    const E = api.Widget.Events;
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("timeout")), SOUNDCLOUD_READY_TIMEOUT_MS);
        widget.bind(E.READY, () => {
          clearTimeout(timer);
          resolve();
        });
        widget.bind(E.ERROR, () => {
          clearTimeout(timer);
          reject(new Error("error"));
        });
      });
    } catch {
      return this.fail(token, "SoundCloud couldn't load that track (private, removed, region-blocked, or offline).");
    }
    if (token !== this.loadToken) return;
    widget.unbind(E.ERROR);
    widget.bind(E.PLAY, () => {
      if (this.current !== src) return;
      this.setState({ status: "playing", error: null });
      this.startTicker();
    });
    widget.bind(E.PAUSE, () => {
      if (this.current === src) this.setState({ status: "paused", currentTime: src.position });
    });
    widget.bind(E.FINISH, () => {
      if (this.current === src) this.setState({ status: "ended" });
    });
    widget.bind(E.PLAY_PROGRESS, (data) => {
      if (this.current === src && data?.currentPosition !== undefined) src.position = data.currentPosition / 1000;
    });
    widget.bind(E.SEEK, (data) => {
      if (this.current === src && data?.currentPosition !== undefined) {
        src.position = data.currentPosition / 1000;
        this.setState({ currentTime: src.position });
      }
    });
    src.cleanups.push(() => {
      for (const ev of [E.READY, E.PLAY, E.PAUSE, E.FINISH, E.PLAY_PROGRESS, E.SEEK, E.ERROR]) {
        try {
          widget.unbind(ev);
        } catch {
          /* ignore */
        }
      }
    });
    this.applyVolume();
    const [duration, sound] = await Promise.all([
      new Promise<number>((resolve) => widget.getDuration((ms) => resolve(ms / 1000))),
      new Promise<{ title?: string; user?: { username?: string } } | null>((resolve) => widget.getCurrentSound((s) => resolve(s))),
    ]);
    if (token !== this.loadToken) return;
    const title = sound?.title ? (sound.user?.username ? `${sound.user.username} — ${sound.title}` : sound.title) : info.label;
    const readyInfo: AudioSourceInfo = { ...info, label: title.slice(0, 120) };
    src.info = readyInfo;
    this.setState({ status: "ready", source: readyInfo, duration: finiteDuration(duration), error: null });
  }

  unload(): void {
    this.loadToken++;
    this.releaseSource();
    this.setState({ status: "empty", source: null, currentTime: 0, duration: 0, isLive: false, error: null });
  }

  /* ------------------------------------------------------------------ */
  /* Transport                                                           */
  /* ------------------------------------------------------------------ */

  async play(): Promise<void> {
    const src = this.current;
    if (!src || this.state.status === "loading") return;
    if (src.kind === "microphone") {
      if (src.suspended && src.node && this.analysisBus) {
        src.node.connect(this.analysisBus);
        src.suspended = false;
      }
      await this.resumeContext();
      this.setState({ status: "playing" });
      this.startLoop();
      return;
    }
    if (src.widget) {
      src.widget.play();
      return;
    }
    if (!src.element) return;
    if (src.analysed) await this.resumeContext();
    try {
      await src.element.play();
    } catch (e) {
      const name = (e as { name?: string }).name;
      if (name === "AbortError" || this.current !== src) return;
      const message = name === "NotAllowedError" ? "The browser blocked playback — press play again." : "Playback failed.";
      this.setState({ error: message });
    }
  }

  pause(): void {
    const src = this.current;
    if (!src) return;
    if (src.kind === "microphone") {
      if (!src.suspended && src.node) {
        try {
          src.node.disconnect();
        } catch {
          /* ignore */
        }
        src.suspended = true;
      }
      this.setState({ status: "paused" });
      return;
    }
    if (src.widget) src.widget.pause();
    else src.element?.pause();
  }

  async togglePlay(): Promise<void> {
    if (this.state.status === "playing") this.pause();
    else await this.play();
  }

  async restart(): Promise<void> {
    this.seek(0);
    await this.play();
  }

  seek(seconds: number): void {
    const src = this.current;
    if (!src || src.kind === "microphone" || !Number.isFinite(seconds)) return;
    const duration = this.state.duration;
    const t = Math.max(0, duration > 0 ? Math.min(duration, seconds) : seconds);
    if (src.widget) {
      src.position = t;
      src.widget.seekTo(t * 1000);
    } else if (src.element) {
      src.element.currentTime = t;
    }
    if (this.state.status === "ended" && t < duration) this.setState({ status: "paused", currentTime: t });
    else this.setState({ currentTime: t });
  }

  setVolume(volume: number): void {
    const v = Math.min(1, Math.max(0, Number.isFinite(volume) ? volume : 0));
    this.setState({ volume: v });
    this.applyVolume();
  }

  setMuted(muted: boolean): void {
    this.setState({ muted });
    this.applyVolume();
  }

  /* ------------------------------------------------------------------ */
  /* Accessors                                                           */
  /* ------------------------------------------------------------------ */

  getMediaElement(): HTMLAudioElement | null {
    const src = this.current;
    return src && (src.kind === "file" || src.kind === "url") ? src.element : null;
  }

  getFeatures(): Readonly<AudioFeatures> {
    return audioBus.features;
  }

  getSpectrum(): Readonly<Float32Array> {
    return audioBus.spectrum;
  }

  subscribeFeatures(listener: FeatureListener): () => void {
    const unsubscribe = subscribeAudioFrames(listener);
    return () => {
      unsubscribe();
    };
  }

  getAudioProfile(): AudioProfile | null {
    const src = this.current;
    if (!src || !src.analysed || src.kind === "soundcloud") return null;
    const numbers = summarizeStats(this.analyzer.stats);
    if (numbers.analyzedSec < 0.5) return null;
    const parsed = AudioProfileSchema.safeParse({
      source: src.kind,
      durationSec: Math.min(36000, this.state.duration),
      ...numbers,
    });
    return parsed.success ? parsed.data : null;
  }

  getRecordingStream(): MediaStream | null {
    const src = this.current;
    if (!src || !src.analysed || !this.recordDest) return null;
    return this.recordDest.stream;
  }

  dispose(): void {
    if (this.disposed) return;
    this.unload();
    this.disposed = true;
    this.stateListeners.clear();
    const ctx = this.ctx;
    this.ctx = null;
    this.analysisBus = this.monitorGain = null;
    this.analyser = null;
    this.recordDest = null;
    if (ctx && ctx.state !== "closed") void ctx.close().catch(() => {});
  }

  private assertAlive(): void {
    if (this.disposed) throw new SupersededError();
  }
}

export function isAudioEngine(value: unknown): value is AudioEngine {
  return value instanceof AudioEngine;
}

/**
 * AUDIO CONTRACT — owned by the lead orchestrator, implemented by Agent 2.
 *
 * One AudioController instance (registered in `@/shared/runtime/registry`)
 * owns the single active media source. Playback and analysis always use the
 * same source node, so what you hear is what drives the visuals.
 */
import { z } from "zod";

/** Real-time features, every value normalised to 0..1. */
export interface AudioFeatures {
  /** ~20-250 Hz */
  bass: number;
  /** ~250-2000 Hz */
  mids: number;
  /** ~2-16 kHz */
  highs: number;
  /** Overall loudness. */
  energy: number;
  /** Transient / beat strength: jumps towards 1 on a detected onset and decays. */
  onset: number;
}

export const AUDIO_FEATURE_KEYS = ["bass", "mids", "highs", "energy", "onset"] as const satisfies readonly (keyof AudioFeatures)[];

export function createSilentFeatures(): AudioFeatures {
  return { bass: 0, mids: 0, highs: 0, energy: 0, onset: 0 };
}

/** Number of log-spaced bins in the shared spectrum array (values 0..1). */
export const SPECTRUM_BINS = 64;

export type AudioSourceKind = "file" | "url" | "microphone" | "soundcloud";

export interface AudioSourceInfo {
  kind: AudioSourceKind;
  /** File name, URL host/path, "Microphone", or SoundCloud title. */
  label: string;
  url?: string;
  mimeType?: string;
  sizeBytes?: number;
  /**
   * "available": the source feeds the Web Audio analyser (real reactivity).
   * "unavailable": playback-only (SoundCloud embed, CORS-blocked URL). Visuals
   * must not pretend to react to it.
   */
  analysis: "available" | "unavailable";
  /** Why analysis is unavailable, shown in the UI. */
  analysisNote?: string;
}

export type PlaybackStatus = "empty" | "loading" | "ready" | "playing" | "paused" | "ended" | "error";

/** Serializable snapshot for UI. Published at most ~10x/second (never per frame). */
export interface AudioControllerState {
  status: PlaybackStatus;
  source: AudioSourceInfo | null;
  /** Seconds. */
  currentTime: number;
  /** Seconds; 0 when unknown. Live microphone input has isLive=true. */
  duration: number;
  isLive: boolean;
  /** 0..1 */
  volume: number;
  muted: boolean;
  error: string | null;
}

export type FeatureListener = (features: Readonly<AudioFeatures>, spectrum: Readonly<Float32Array>) => void;
export type StateListener = (state: AudioControllerState) => void;

/** Summary of the music so far, used by AI scene intelligence. */
export const AudioProfileSchema = z.object({
  source: z.enum(["file", "url", "microphone"]),
  /** Seconds of audio analysed so far. */
  analyzedSec: z.number().min(0).max(36000),
  durationSec: z.number().min(0).max(36000),
  avgEnergy: z.number().min(0).max(1),
  peakEnergy: z.number().min(0).max(1),
  /** Share of band energy; bass+mids+highs ≈ 1. */
  bassRatio: z.number().min(0).max(1),
  midsRatio: z.number().min(0).max(1),
  highsRatio: z.number().min(0).max(1),
  /** Detected onsets per second. */
  onsetRate: z.number().min(0).max(20),
  /** Rough tempo estimate; null when unknown. */
  tempoBpm: z.number().min(40).max(220).nullable(),
  /** 0 = flat/compressed, 1 = highly dynamic. */
  dynamics: z.number().min(0).max(1),
});
export type AudioProfile = z.infer<typeof AudioProfileSchema>;

export const ACCEPTED_AUDIO_MIME_TYPES = ["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave"] as const;
export const ACCEPTED_AUDIO_EXTENSIONS = [".mp3", ".wav"] as const;
export const MAX_AUDIO_FILE_BYTES = 200 * 1024 * 1024;

export interface AudioController {
  getState(): AudioControllerState;
  subscribeState(listener: StateListener): () => void;

  /** Validates type/size, replaces the current source, and prepares playback. Rejects with a user-facing Error. */
  loadFile(file: File): Promise<void>;
  /** Direct audio URL. Tries CORS-enabled analysis first, falls back to playback-only. */
  loadUrl(url: string): Promise<void>;
  /** Live microphone (requires permission). Not routed to speakers. */
  startMicrophone(): Promise<void>;
  /** Official SoundCloud embed widget; always playback-only. */
  loadSoundCloud(url: string): Promise<void>;
  /** Stops and releases the current source (object URLs, nodes, streams). */
  unload(): void;

  play(): Promise<void>;
  pause(): void;
  togglePlay(): Promise<void>;
  /** Seek to 0 and play. */
  restart(): Promise<void>;
  seek(seconds: number): void;
  setVolume(volume: number): void;
  setMuted(muted: boolean): void;

  /** The single active media element (null for microphone/SoundCloud/none). */
  getMediaElement(): HTMLAudioElement | null;

  /** Latest features (shared mutable object — read, don't store). Same object as audioBus.features. */
  getFeatures(): Readonly<AudioFeatures>;
  getSpectrum(): Readonly<Float32Array>;
  /** Called once per analysis frame while a source is active. */
  subscribeFeatures(listener: FeatureListener): () => void;

  getAudioProfile(): AudioProfile | null;
  /**
   * An audio MediaStream of what is currently playing, for recording.
   * null when the source is playback-only, nothing is loaded, or unsupported.
   */
  getRecordingStream(): MediaStream | null;

  dispose(): void;
}

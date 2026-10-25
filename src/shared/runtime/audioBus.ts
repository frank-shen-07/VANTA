/**
 * Per-frame audio data bus — owned by the lead orchestrator.
 *
 * The audio engine (Agent 2) WRITES here once per analysis frame via
 * `publishAudioFrame`. The renderer and modulation engine READ `audioBus.features`
 * / `audioBus.spectrum` inside their animation loop. No React state is involved,
 * so nothing re-renders per frame.
 */
import { SPECTRUM_BINS, createSilentFeatures, type AudioFeatures, type FeatureListener } from "@/shared/audio/contract";

export interface AudioBus {
  /** Mutated in place. */
  readonly features: AudioFeatures;
  /** Log-spaced magnitudes 0..1, mutated in place. */
  readonly spectrum: Float32Array;
  /** True while a source with real analysis is running. */
  analysisActive: boolean;
  /** performance.now() of the last publish. */
  lastUpdate: number;
}

export const audioBus: AudioBus = {
  features: createSilentFeatures(),
  spectrum: new Float32Array(SPECTRUM_BINS),
  analysisActive: false,
  lastUpdate: 0,
};

const listeners = new Set<FeatureListener>();

/** Copies new values into the bus (no allocation) and notifies subscribers. */
export function publishAudioFrame(features: Readonly<AudioFeatures>, spectrum?: ArrayLike<number>): void {
  const f = audioBus.features;
  f.bass = features.bass;
  f.mids = features.mids;
  f.highs = features.highs;
  f.energy = features.energy;
  f.onset = features.onset;
  if (spectrum) {
    const n = Math.min(spectrum.length, audioBus.spectrum.length);
    for (let i = 0; i < n; i++) audioBus.spectrum[i] = spectrum[i];
  }
  audioBus.lastUpdate = typeof performance !== "undefined" ? performance.now() : Date.now();
  for (const listener of listeners) listener(audioBus.features, audioBus.spectrum);
}

/** Resets everything to silence (call when a source stops or becomes playback-only). */
export function resetAudioBus(): void {
  publishAudioFrame(createSilentFeatures());
  audioBus.spectrum.fill(0);
  audioBus.analysisActive = false;
}

export function setAnalysisActive(active: boolean): void {
  audioBus.analysisActive = active;
}

export function subscribeAudioFrames(listener: FeatureListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

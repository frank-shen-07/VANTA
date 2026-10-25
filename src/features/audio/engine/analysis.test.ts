import { describe, expect, it } from "vitest";
import { AudioAnalyzer, estimateTempo } from "./analysis";
import { validateAudioFile } from "./validation";
import { exportFileName, pickFormat, sanitizeFileStem } from "@/features/export/recorder";

const SR = 48000;
const FFT = 2048;
const BINS = FFT / 2;

/** Synthetic analyser spectrum: one tone (with Blackman-like leakage) or broadband. */
function toneSpectrum(hz: number, peakDb = -14): Float32Array {
  const out = new Float32Array(BINS).fill(-Infinity);
  const k = Math.round(hz / (SR / FFT));
  for (let d = -3; d <= 3; d++) {
    const i = k + d;
    if (i > 0 && i < BINS) out[i] = peakDb - Math.abs(d) * 20;
  }
  return out;
}
const silence = () => new Float32Array(BINS).fill(-Infinity);
const flat = (db: number) => new Float32Array(BINS).fill(db);
const sine = (amp: number) => Float32Array.from({ length: FFT }, (_, i) => amp * Math.sin(i * 0.1));

function run(a: AudioAnalyzer, frames: number, spec: Float32Array, td: Float32Array, t0 = 0, active = true) {
  for (let i = 0; i < frames; i++) a.process({ frequencyDb: spec, timeDomain: td, dt: 1 / 60, release: 0.5, active, time: t0 + i / 60 });
}

describe("audio analysis", () => {
  it("60 Hz sine → bass dominant", () => {
    const a = new AudioAnalyzer(SR, FFT);
    run(a, 60, toneSpectrum(60), sine(0.5));
    expect(a.features.bass).toBeGreaterThan(0.8);
    expect(a.features.mids).toBeLessThan(0.2);
    expect(a.features.highs).toBeLessThan(0.1);
  });

  it("5 kHz sine → highs dominant", () => {
    const a = new AudioAnalyzer(SR, FFT);
    run(a, 60, toneSpectrum(5000), sine(0.5));
    expect(a.features.highs).toBeGreaterThan(0.8);
    expect(a.features.bass).toBeLessThan(0.1);
  });

  it("silence → zeros", () => {
    const a = new AudioAnalyzer(SR, FFT);
    run(a, 30, silence(), new Float32Array(FFT));
    expect(a.features).toEqual({ bass: 0, mids: 0, highs: 0, energy: 0, onset: 0 });
    expect(Array.from(a.spectrum).every((v) => v === 0)).toBe(true);
  });

  it("detects an onset on a step input and the envelope decays", () => {
    const a = new AudioAnalyzer(SR, FFT);
    run(a, 60, silence(), new Float32Array(FFT));
    expect(a.features.onset).toBe(0);
    run(a, 1, flat(-30), sine(0.5), 1);
    expect(a.features.onset).toBeGreaterThan(0.5);
    run(a, 18, flat(-30), sine(0.5), 1.02);
    expect(a.features.onset).toBeLessThan(0.15);
    expect(a.stats.onsetCount).toBe(1);
  });

  it("keeps every output within 0..1 for loud and quiet input, and decays to 0 when paused", () => {
    const a = new AudioAnalyzer(SR, FFT);
    for (const db of [0, -20, -60, -90]) {
      run(a, 20, flat(db), sine(Math.pow(10, db / 20)));
      for (const v of Object.values(a.features)) expect(v >= 0 && v <= 1).toBe(true);
      expect(Array.from(a.spectrum).every((v) => v >= 0 && v <= 1)).toBe(true);
    }
    // quiet track adapts towards full scale
    const q = new AudioAnalyzer(SR, FFT);
    run(q, 120, toneSpectrum(80, -50), sine(0.01));
    expect(q.features.bass).toBeGreaterThan(0.8);
    run(q, 120, silence(), new Float32Array(FFT), 5, false);
    expect(q.isSilent()).toBe(true);
  });

  it("estimates tempo from regular onsets", () => {
    const times = Array.from({ length: 16 }, (_, i) => i * 0.5);
    expect(estimateTempo(times)).toBeCloseTo(120, 0);
    expect(estimateTempo([0, 1])).toBeNull();
  });
});

describe("file validation", () => {
  it("accepts mp3/wav and rejects other files", () => {
    expect(validateAudioFile({ name: "a.mp3", type: "audio/mpeg", size: 10 }).ok).toBe(true);
    expect(validateAudioFile({ name: "a.WAV", type: "", size: 10 }).ok).toBe(true);
    expect(validateAudioFile({ name: "a.png", type: "image/png", size: 10 }).ok).toBe(false);
    expect(validateAudioFile({ name: "a.mp3", type: "text/plain", size: 10 }).ok).toBe(false);
    expect(validateAudioFile({ name: "a.mp3", type: "audio/mpeg", size: 0 }).ok).toBe(false);
    expect(validateAudioFile({ name: "a.mp3", type: "audio/mpeg", size: 300 * 1024 * 1024 }).ok).toBe(false);
  });
});

describe("recorder helpers", () => {
  it("picks the best supported mime type", () => {
    const only = (...types: string[]) => (t: string) => types.includes(t);
    expect(pickFormat(only("video/webm;codecs=vp9,opus", "video/webm"))?.id).toBe("webm-vp9-opus");
    expect(pickFormat(only("video/webm"))?.id).toBe("webm");
    expect(pickFormat(only("video/mp4"))?.extension).toBe("mp4");
    expect(pickFormat(only())).toBeNull();
    expect(pickFormat(only("video/webm", "video/webm;codecs=vp8,opus"), "webm")?.id).toBe("webm");
  });

  it("sanitises file names", () => {
    expect(sanitizeFileStem("My Scene: Neon / #1")).toBe("my-scene-neon-1");
    expect(sanitizeFileStem("***")).toBe("scene");
    expect(exportFileName("Néon Tunnel", new Date(2026, 9, 26, 1, 2, 3), "webm")).toBe("vanta-neon-tunnel-20261026-010203.webm");
  });
});

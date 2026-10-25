/**
 * Real-time audio feature extraction (pure DSP, no Web Audio dependency).
 *
 * Input per frame: the AnalyserNode's dB magnitude spectrum
 * (getFloatFrequencyData) and time-domain samples (getFloatTimeDomainData).
 * Output: AudioFeatures (bass/mids/highs/energy/onset, all 0..1) and a
 * 64-bin log-spaced spectrum (0..1). Allocation-free in the steady state.
 *
 * Pipeline
 *  - band level   = RMS of linear bin magnitudes inside the band
 *  - normalisation = level / reference, where the reference is a slowly
 *    decaying running peak per band, floored relative to the loudest band (so
 *    leakage in an empty band is never auto-gained up to 1) and by an absolute
 *    floor (so near-silence/noise is never amplified)
 *  - onset         = spectral flux of log-compressed magnitudes against an
 *    adaptive (EMA mean + k·deviation) threshold → envelope that jumps up and
 *    decays to ~10 % in ~200 ms
 *  - smoothing     = fast attack, release driven by scene.audio.smoothing
 */
import { SPECTRUM_BINS, createSilentFeatures, type AudioFeatures } from "@/shared/audio/contract";

export const BAND_RANGES = {
  bass: [20, 250],
  mids: [250, 2000],
  highs: [2000, 16000],
} as const;

/** Running-peak decay for auto-gain, in dB per second. */
const PEAK_DECAY_DB_PER_SEC = 2;
/** Band reference is never below (loudest band peak × this): −36 dB. */
const RELATIVE_FLOOR = Math.pow(10, -36 / 20);
/** Absolute reference floor for band levels (≈ −80 dB re analyser full scale). */
const BAND_ABS_FLOOR = 1e-4;
/** Below this band level the band reads as silence. */
const BAND_GATE = 1e-6;
/** Time-domain RMS floor (−60 dBFS) and gate (−100 dBFS). */
const ENERGY_ABS_FLOOR = 1e-3;
const ENERGY_GATE = 1e-5;
/** Fraction of the remaining distance kept per 60 fps frame while rising. */
const ATTACK = 0.25;
/** Spectrum display range below the running spectral peak, in dB. */
const SPECTRUM_RANGE_DB = 60;
const SPECTRUM_FLOOR_DB = -100;
const SPECTRUM_MIN_HZ = 30;
/** Onset envelope decays to 10 % after this many seconds. */
const ONSET_DECAY_SEC = 0.2;
const ONSET_REFRACTORY_SEC = 0.09;
const ONSET_THRESHOLD_K = 1.6;
const ONSET_MIN_FLUX = 0.04;
const FLUX_STATS_TAU = 0.6;
/** Log compression constant for onset flux: c = ln(1 + C·m). */
const FLUX_COMPRESSION = 1e4;
const MAX_ONSET_HISTORY = 128;

export interface AnalysisFrame {
  /** dB magnitudes, length = fftSize / 2 (−Infinity allowed). */
  frequencyDb: ArrayLike<number>;
  /** Samples in −1..1 (any length; may be empty). */
  timeDomain: ArrayLike<number>;
  /** Seconds since the previous frame. */
  dt: number;
  /** Release smoothing 0..0.95 (scene.audio.smoothing). */
  release: number;
  /** False while paused: values decay to 0, nothing is accumulated. */
  active: boolean;
  /** Monotonic time in seconds (for onset timing). */
  time: number;
}

export interface AnalysisStats {
  analyzedSec: number;
  /** Σ absolute loudness (0..1, −60..0 dBFS) × dt */
  loudnessSum: number;
  loudnessPeak: number;
  /** Σ band levels × dt (linear RMS). */
  bandSums: [number, number, number];
  onsetCount: number;
  onsetTimes: number[];
  /** Welford accumulators over frame loudness in dB (non-silent frames). */
  dbCount: number;
  dbMean: number;
  dbM2: number;
}

interface BandRange {
  start: number;
  end: number;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : Number.isFinite(v) ? v : 0;
}

/** dB → linear magnitude (−Infinity → 0). */
export function dbToLinear(db: number): number {
  if (!(db > -400)) return 0;
  return Math.exp(db * 0.11512925464970229);
}

/** Inclusive FFT-bin range covering [loHz, hiHz). Always at least one bin. */
export function binRange(loHz: number, hiHz: number, sampleRate: number, fftSize: number): BandRange {
  const binHz = sampleRate / fftSize;
  const last = fftSize / 2 - 1;
  let start = Math.max(1, Math.ceil(loHz / binHz));
  let end = Math.min(last, Math.ceil(hiHz / binHz) - 1);
  if (start > last) start = last;
  if (end < start) end = start;
  return { start, end };
}

/** Frame-rate independent attack/release follower. */
export function follow(prev: number, target: number, dt: number, release: number): number {
  const frames = Math.max(0, dt) * 60;
  const k = target >= prev ? Math.pow(ATTACK, frames) : Math.pow(Math.min(0.99, Math.max(0, release)), frames);
  return target + (prev - target) * k;
}

/**
 * Estimates tempo from onset times (seconds) using a folded inter-onset-interval
 * histogram. Returns null when there is not enough evidence.
 */
export function estimateTempo(onsetTimes: readonly number[]): number | null {
  const n = onsetTimes.length;
  if (n < 6) return null;
  const hist = new Float64Array(81); // 80..160 BPM in 1 BPM buckets
  let total = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n && j <= i + 8; j++) {
      const d = onsetTimes[j] - onsetTimes[i];
      if (d < 0.2 || d > 2.4) continue;
      let bpm = 60 / d;
      while (bpm < 80) bpm *= 2;
      while (bpm >= 160) bpm /= 2;
      const weight = 1 / (j - i);
      const center = bpm - 80;
      for (let b = Math.max(0, Math.floor(center) - 2); b <= Math.min(80, Math.ceil(center) + 2); b++) {
        const w = weight * Math.exp(-((b - center) ** 2) / 2);
        hist[b] += w;
        total += w;
      }
    }
  }
  if (total <= 0) return null;
  let best = 0;
  for (let b = 1; b < hist.length; b++) if (hist[b] > hist[best]) best = b;
  // Weighted mean around the best bucket for sub-bucket precision.
  let num = 0;
  let den = 0;
  for (let b = Math.max(0, best - 2); b <= Math.min(80, best + 2); b++) {
    num += (b + 80) * hist[b];
    den += hist[b];
  }
  let windowShare = 0;
  for (let b = Math.max(0, best - 3); b <= Math.min(80, best + 3); b++) windowShare += hist[b];
  if (windowShare / total < 0.2) return null;
  const bpm = num / den;
  return Math.min(220, Math.max(40, Math.round(bpm * 10) / 10));
}

export class AudioAnalyzer {
  /** Smoothed output (0..1). */
  readonly features: AudioFeatures = createSilentFeatures();
  /** Smoothed log-spaced spectrum (0..1). */
  readonly spectrum = new Float32Array(SPECTRUM_BINS);
  /** Normalised, unsmoothed values of the last frame (useful for tests/meters). */
  readonly raw: AudioFeatures = createSilentFeatures();
  stats: AnalysisStats = AudioAnalyzer.emptyStats();

  private sampleRate = 0;
  private fftSize = 0;
  private bands: [BandRange, BandRange, BandRange] = [
    { start: 1, end: 1 },
    { start: 1, end: 1 },
    { start: 1, end: 1 },
  ];
  private specRanges: BandRange[] = [];
  private specTilt = new Float32Array(SPECTRUM_BINS);
  private fluxRange: BandRange = { start: 1, end: 1 };
  private prevCompressed = new Float32Array(0);
  private hasPrev = false;
  private bandPeaks = [0, 0, 0];
  private energyPeak = 0;
  private spectrumPeakDb = SPECTRUM_FLOOR_DB;
  private fluxMean = 0;
  private fluxDev = 0;
  private fluxPrimed = 0;
  private lastOnsetTime = -Infinity;
  private onsetEnv = 0;

  constructor(sampleRate = 48000, fftSize = 2048) {
    this.configure(sampleRate, fftSize);
  }

  static emptyStats(): AnalysisStats {
    return {
      analyzedSec: 0,
      loudnessSum: 0,
      loudnessPeak: 0,
      bandSums: [0, 0, 0],
      onsetCount: 0,
      onsetTimes: [],
      dbCount: 0,
      dbMean: 0,
      dbM2: 0,
    };
  }

  configure(sampleRate: number, fftSize: number): void {
    if (sampleRate === this.sampleRate && fftSize === this.fftSize) return;
    this.sampleRate = sampleRate;
    this.fftSize = fftSize;
    const nyquist = sampleRate / 2;
    this.bands = [
      binRange(BAND_RANGES.bass[0], BAND_RANGES.bass[1], sampleRate, fftSize),
      binRange(BAND_RANGES.mids[0], BAND_RANGES.mids[1], sampleRate, fftSize),
      binRange(BAND_RANGES.highs[0], Math.min(BAND_RANGES.highs[1], nyquist), sampleRate, fftSize),
    ];
    const maxHz = Math.min(16000, nyquist);
    const ratio = Math.pow(maxHz / SPECTRUM_MIN_HZ, 1 / SPECTRUM_BINS);
    this.specRanges = [];
    for (let i = 0; i < SPECTRUM_BINS; i++) {
      const lo = SPECTRUM_MIN_HZ * Math.pow(ratio, i);
      const hi = lo * ratio;
      this.specRanges.push(binRange(lo, hi, sampleRate, fftSize));
      // +3 dB/octave tilt (relative to 1 kHz) so highs are visible next to bass.
      this.specTilt[i] = 3 * Math.log2(Math.sqrt(lo * hi) / 1000);
    }
    this.fluxRange = binRange(SPECTRUM_MIN_HZ, maxHz, sampleRate, fftSize);
    this.prevCompressed = new Float32Array(fftSize / 2);
    this.reset();
  }

  /** Clears all adaptive state and statistics (new source). */
  reset(): void {
    const f = this.features;
    f.bass = f.mids = f.highs = f.energy = f.onset = 0;
    const r = this.raw;
    r.bass = r.mids = r.highs = r.energy = r.onset = 0;
    this.spectrum.fill(0);
    this.prevCompressed.fill(0);
    this.hasPrev = false;
    this.bandPeaks[0] = this.bandPeaks[1] = this.bandPeaks[2] = 0;
    this.energyPeak = 0;
    this.spectrumPeakDb = SPECTRUM_FLOOR_DB;
    this.fluxMean = 0;
    this.fluxDev = 0;
    this.fluxPrimed = 0;
    this.lastOnsetTime = -Infinity;
    this.onsetEnv = 0;
    this.stats = AudioAnalyzer.emptyStats();
  }

  /** True when every output is (practically) zero. */
  isSilent(epsilon = 1e-3): boolean {
    const f = this.features;
    if (f.bass > epsilon || f.mids > epsilon || f.highs > epsilon || f.energy > epsilon || f.onset > epsilon) return false;
    for (let i = 0; i < this.spectrum.length; i++) if (this.spectrum[i] > epsilon) return false;
    return true;
  }

  process(frame: AnalysisFrame): void {
    const dt = Math.min(0.25, Math.max(0, frame.dt));
    const release = frame.release;
    const decay = Math.pow(10, (-PEAK_DECAY_DB_PER_SEC * dt) / 20);
    const raw = this.raw;
    const f = this.features;

    // Onset envelope always decays.
    this.onsetEnv *= Math.pow(0.1, dt / ONSET_DECAY_SEC);

    if (!frame.active) {
      raw.bass = raw.mids = raw.highs = raw.energy = raw.onset = 0;
      f.bass = follow(f.bass, 0, dt, release);
      f.mids = follow(f.mids, 0, dt, release);
      f.highs = follow(f.highs, 0, dt, release);
      f.energy = follow(f.energy, 0, dt, release);
      f.onset = this.onsetEnv;
      for (let i = 0; i < this.spectrum.length; i++) this.spectrum[i] = follow(this.spectrum[i], 0, dt, release);
      this.hasPrev = false;
      return;
    }

    const db = frame.frequencyDb;
    const bins = Math.min(db.length, this.fftSize / 2);

    /* ---- band levels ---- */
    const levels = [0, 0, 0];
    for (let b = 0; b < 3; b++) {
      const { start, end } = this.bands[b];
      let power = 0;
      let count = 0;
      for (let k = start; k <= end && k < bins; k++) {
        const m = dbToLinear(db[k]);
        power += m * m;
        count++;
      }
      levels[b] = count > 0 ? Math.sqrt(power / count) : 0;
      this.bandPeaks[b] = Math.max(levels[b], this.bandPeaks[b] * decay);
    }
    const globalPeak = Math.max(this.bandPeaks[0], this.bandPeaks[1], this.bandPeaks[2]);
    const norm = [0, 0, 0];
    for (let b = 0; b < 3; b++) {
      const ref = Math.max(this.bandPeaks[b], globalPeak * RELATIVE_FLOOR, BAND_ABS_FLOOR);
      norm[b] = levels[b] < BAND_GATE ? 0 : clamp01(levels[b] / ref);
    }

    /* ---- energy (time-domain RMS) ---- */
    const td = frame.timeDomain;
    let sum = 0;
    for (let i = 0; i < td.length; i++) sum += td[i] * td[i];
    const rms = td.length > 0 ? Math.sqrt(sum / td.length) : 0;
    this.energyPeak = Math.max(rms, this.energyPeak * decay);
    const energyRef = Math.max(this.energyPeak, ENERGY_ABS_FLOOR);
    const energy = rms < ENERGY_GATE ? 0 : clamp01(rms / energyRef);

    /* ---- spectral flux onset ---- */
    let flux = 0;
    const { start: fs, end: fe } = this.fluxRange;
    let fluxCount = 0;
    for (let k = fs; k <= fe && k < bins; k++) {
      const c = Math.log1p(FLUX_COMPRESSION * dbToLinear(db[k]));
      if (this.hasPrev) {
        const d = c - this.prevCompressed[k];
        if (d > 0) flux += d;
      }
      this.prevCompressed[k] = c;
      fluxCount++;
    }
    flux = fluxCount > 0 ? flux / fluxCount : 0;
    let onsetDetected = false;
    if (this.hasPrev) {
      const threshold = this.fluxMean + ONSET_THRESHOLD_K * this.fluxDev + ONSET_MIN_FLUX;
      if (flux > threshold && frame.time - this.lastOnsetTime >= ONSET_REFRACTORY_SEC) {
        onsetDetected = true;
        this.lastOnsetTime = frame.time;
        const strength = clamp01(0.6 + (flux - threshold) / (threshold + 1e-6));
        this.onsetEnv = Math.max(this.onsetEnv, strength);
      }
      const alpha = 1 - Math.exp(-dt / FLUX_STATS_TAU);
      // Clip the outlier's influence so one huge onset doesn't mask the next ones.
      const clipped = Math.min(flux, this.fluxMean + 4 * this.fluxDev + ONSET_MIN_FLUX * 4);
      this.fluxMean += alpha * (clipped - this.fluxMean);
      this.fluxDev += alpha * (Math.abs(clipped - this.fluxMean) - this.fluxDev);
      this.fluxPrimed += dt;
    }
    this.hasPrev = true;

    raw.bass = norm[0];
    raw.mids = norm[1];
    raw.highs = norm[2];
    raw.energy = energy;
    raw.onset = this.onsetEnv;

    f.bass = follow(f.bass, norm[0], dt, release);
    f.mids = follow(f.mids, norm[1], dt, release);
    f.highs = follow(f.highs, norm[2], dt, release);
    f.energy = follow(f.energy, energy, dt, release);
    f.onset = this.onsetEnv;

    /* ---- 64-bin log spectrum ---- */
    let frameMaxDb = -Infinity;
    for (let i = 0; i < SPECTRUM_BINS; i++) {
      const { start, end } = this.specRanges[i];
      let max = 0;
      for (let k = start; k <= end && k < bins; k++) {
        const m = dbToLinear(db[k]);
        if (m > max) max = m;
      }
      const v = max > 0 ? 20 * Math.log10(max) + this.specTilt[i] : -Infinity;
      if (v > frameMaxDb) frameMaxDb = v;
    }
    this.spectrumPeakDb = Math.max(frameMaxDb, this.spectrumPeakDb - PEAK_DECAY_DB_PER_SEC * dt, SPECTRUM_FLOOR_DB + SPECTRUM_RANGE_DB);
    const floorDb = this.spectrumPeakDb - SPECTRUM_RANGE_DB;
    for (let i = 0; i < SPECTRUM_BINS; i++) {
      const { start, end } = this.specRanges[i];
      let max = 0;
      for (let k = start; k <= end && k < bins; k++) {
        const m = dbToLinear(db[k]);
        if (m > max) max = m;
      }
      const v = max > 0 ? clamp01((20 * Math.log10(max) + this.specTilt[i] - floorDb) / SPECTRUM_RANGE_DB) : 0;
      this.spectrum[i] = follow(this.spectrum[i], v, dt, release);
    }

    /* ---- running statistics for the audio profile ---- */
    const s = this.stats;
    s.analyzedSec += dt;
    const rmsDb = rms > 0 ? 20 * Math.log10(rms) : -Infinity;
    const loudness = clamp01((rmsDb + 60) / 60);
    s.loudnessSum += loudness * dt;
    if (loudness > s.loudnessPeak) s.loudnessPeak = loudness;
    s.bandSums[0] += levels[0] * dt;
    s.bandSums[1] += levels[1] * dt;
    s.bandSums[2] += levels[2] * dt;
    if (rmsDb > -70) {
      s.dbCount++;
      const delta = rmsDb - s.dbMean;
      s.dbMean += delta / s.dbCount;
      s.dbM2 += delta * (rmsDb - s.dbMean);
    }
    if (onsetDetected) {
      s.onsetCount++;
      s.onsetTimes.push(frame.time);
      if (s.onsetTimes.length > MAX_ONSET_HISTORY) s.onsetTimes.shift();
    }
  }
}

export interface ProfileNumbers {
  analyzedSec: number;
  avgEnergy: number;
  peakEnergy: number;
  bassRatio: number;
  midsRatio: number;
  highsRatio: number;
  onsetRate: number;
  tempoBpm: number | null;
  dynamics: number;
}

/** Tilt compensation (dB) applied to average band levels before computing shares. */
const BAND_SHARE_COMPENSATION_DB = [0, 10, 20];

/** Summarises running statistics into AudioProfile numbers (all clamped to schema bounds). */
export function summarizeStats(stats: AnalysisStats): ProfileNumbers {
  const t = stats.analyzedSec;
  const comp = stats.bandSums.map((sum, i) => (t > 0 ? (sum / t) * Math.pow(10, BAND_SHARE_COMPENSATION_DB[i] / 20) : 0));
  const total = comp[0] + comp[1] + comp[2];
  const std = stats.dbCount > 1 ? Math.sqrt(stats.dbM2 / (stats.dbCount - 1)) : 0;
  return {
    analyzedSec: Math.min(36000, t),
    avgEnergy: t > 0 ? clamp01(stats.loudnessSum / t) : 0,
    peakEnergy: clamp01(stats.loudnessPeak),
    bassRatio: total > 0 ? clamp01(comp[0] / total) : 0,
    midsRatio: total > 0 ? clamp01(comp[1] / total) : 0,
    highsRatio: total > 0 ? clamp01(comp[2] / total) : 0,
    onsetRate: t > 0 ? Math.min(20, stats.onsetCount / t) : 0,
    tempoBpm: estimateTempo(stats.onsetTimes),
    dynamics: clamp01((std - 2) / 10),
  };
}

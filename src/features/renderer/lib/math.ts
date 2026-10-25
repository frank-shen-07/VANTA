/**
 * Pure, allocation-conscious helpers used by the renderer. No Three.js imports
 * so they can be unit-tested in node.
 */

export type ParticleDistribution = "sphere" | "shell" | "cube" | "disc" | "spiral" | "tunnel";

/** Deterministic PRNG (mulberry32) so a layer looks the same after every rebuild. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable 32-bit hash of a string (layer ids → particle seeds). */
export function hashString(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export interface TunnelExtent {
  /** Far end (most negative z). */
  zMin: number;
  /** Near end (behind the camera). */
  zMax: number;
}

/** Depth range used by the particle "tunnel" distribution (flows from zMin → zMax). */
export function tunnelExtent(spread: number): TunnelExtent {
  const length = spread * 12;
  const zMax = spread * 1.8;
  return { zMin: zMax - length, zMax };
}

export interface ParticleBuffers {
  /** xyz per particle. */
  positions: Float32Array;
  /** x,y,z: random 0..1 seeds; w: colour gradient position 0..1. */
  randoms: Float32Array;
}

/**
 * Generates particle positions for a distribution. `spread` is the radius /
 * half-extent in world units. Every coordinate is finite.
 */
export function generateParticles(distribution: ParticleDistribution, count: number, spread: number, seed = 1): ParticleBuffers {
  const n = Math.max(0, Math.floor(count));
  const positions = new Float32Array(n * 3);
  const randoms = new Float32Array(n * 4);
  const rand = mulberry32(seed);
  const TAU = Math.PI * 2;
  const gaussian = () => {
    // Box–Muller, clamped to keep outliers tame.
    const u = Math.max(1e-6, rand());
    const v = rand();
    const g = Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
    return Math.max(-3, Math.min(3, g));
  };
  const { zMin, zMax } = tunnelExtent(spread);

  for (let i = 0; i < n; i++) {
    let x = 0;
    let y = 0;
    let z = 0;
    let grad = 0;
    switch (distribution) {
      case "sphere": {
        const r = spread * Math.cbrt(rand());
        const theta = TAU * rand();
        const phi = Math.acos(2 * rand() - 1);
        x = r * Math.sin(phi) * Math.cos(theta);
        y = r * Math.cos(phi);
        z = r * Math.sin(phi) * Math.sin(theta);
        grad = r / spread;
        break;
      }
      case "shell": {
        const r = spread * (0.94 + 0.06 * rand());
        const theta = TAU * rand();
        const phi = Math.acos(2 * rand() - 1);
        x = r * Math.sin(phi) * Math.cos(theta);
        y = r * Math.cos(phi);
        z = r * Math.sin(phi) * Math.sin(theta);
        grad = (y / spread + 1) / 2;
        break;
      }
      case "cube": {
        x = (rand() * 2 - 1) * spread;
        y = (rand() * 2 - 1) * spread;
        z = (rand() * 2 - 1) * spread;
        grad = (y / spread + 1) / 2;
        break;
      }
      case "disc": {
        const r = spread * Math.sqrt(rand());
        const a = TAU * rand();
        x = r * Math.cos(a);
        z = r * Math.sin(a);
        y = gaussian() * spread * 0.025 * (1 - (r / spread) * 0.6);
        grad = r / spread;
        break;
      }
      case "spiral": {
        const arms = 3;
        const arm = Math.floor(rand() * arms);
        const t = Math.pow(rand(), 0.75);
        const r = spread * t;
        const a = t * Math.PI * 2.4 + (arm / arms) * TAU;
        const scatter = spread * (0.02 + 0.06 * t);
        x = r * Math.cos(a) + gaussian() * scatter;
        z = r * Math.sin(a) + gaussian() * scatter;
        y = gaussian() * spread * 0.035 * (1.2 - t);
        grad = t;
        break;
      }
      case "tunnel": {
        const a = TAU * rand();
        const r = spread * (0.75 + 0.35 * rand());
        x = r * Math.cos(a);
        y = r * Math.sin(a);
        z = zMin + (zMax - zMin) * rand();
        grad = (z - zMin) / (zMax - zMin);
        break;
      }
    }
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
    randoms[i * 4] = rand();
    randoms[i * 4 + 1] = rand();
    randoms[i * 4 + 2] = rand();
    randoms[i * 4 + 3] = Math.min(1, Math.max(0, grad * 0.85 + rand() * 0.15));
  }
  return { positions, randoms };
}

/**
 * Resamples a log-spaced spectrum (values 0..1) into `out.length` bars.
 * With `mirror`, the first half is resampled and reflected so the bar
 * sequence is symmetric (lows at both ends). Writes into `out`; no allocation.
 */
export function resampleSpectrum(source: ArrayLike<number>, out: Float32Array, mirror: boolean): Float32Array {
  const bars = out.length;
  const srcLen = source.length;
  if (bars === 0) return out;
  if (srcLen === 0) {
    out.fill(0);
    return out;
  }
  const unique = mirror ? Math.ceil(bars / 2) : bars;
  for (let i = 0; i < unique; i++) {
    // Linear interpolation across the source bins.
    const pos = unique === 1 ? 0 : (i / (unique - 1)) * (srcLen - 1);
    const i0 = Math.floor(pos);
    const i1 = Math.min(srcLen - 1, i0 + 1);
    const f = pos - i0;
    const v = source[i0] * (1 - f) + source[i1] * f;
    const clamped = v < 0 ? 0 : v > 1 ? 1 : v;
    if (mirror) {
      out[i] = clamped;
      out[bars - 1 - i] = clamped;
    } else out[i] = clamped;
  }
  return out;
}

/** Attack/release smoothing of bar heights, frame-rate independent. */
export function smoothBars(current: Float32Array, target: Float32Array, dt: number, attack = 0.35, release = 0.88): void {
  const ka = Math.pow(attack, dt * 60);
  const kr = Math.pow(release, dt * 60);
  const n = Math.min(current.length, target.length);
  for (let i = 0; i < n; i++) {
    const c = current[i];
    const t = target[i];
    const k = t > c ? ka : kr;
    current[i] = t + (c - t) * k;
  }
}

/* ------------------------------------------------------------------ */
/* Mapping semantics (see MAPPING_TARGETS in schema.ts)                */
/* ------------------------------------------------------------------ */

/** scale / speed / size / brightness: base × (1 + m), never negative. */
export function multiplyMod(base: number, m: number): number {
  const k = 1 + m;
  return base * (k > 0 ? k : 0);
}

/** opacity × (1 + m), clamped to 0..1. */
export function opacityMod(base: number, m: number): number {
  const v = base * (1 + m);
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Hue shift in turns (0..1 wraps) for a modulation value. */
export function hueTurns(m: number): number {
  return m * 0.5;
}

/** Degrees → radians. */
export const DEG = Math.PI / 180;

/** Ring placement used by the rings shader and its CPU raycast. Returns ring radius and z (tunnel/concentric). */
export function ringRadius(arrangement: "tunnel" | "concentric" | "orbit", index: number, radius: number, spacing: number): number {
  if (arrangement === "concentric") return radius + index * spacing;
  if (arrangement === "orbit") return radius + index * spacing * 0.2;
  return radius;
}

export function ringTunnelLength(count: number, spacing: number): number {
  return Math.max(1, count) * Math.max(0.25, spacing);
}

/** z position of tunnel ring `index` at layer time `t` (rings flow towards +z). */
export function ringTunnelZ(index: number, count: number, spacing: number, t: number): number {
  const length = ringTunnelLength(count, spacing);
  const s = Math.max(0.25, spacing);
  let d = (index * s - t * s * 0.9) % length;
  if (d < 0) d += length;
  return length * 0.15 - d;
}

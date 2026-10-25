import { describe, expect, it } from "vitest";
import {
  generateParticles,
  hashString,
  hueTurns,
  multiplyMod,
  mulberry32,
  opacityMod,
  resampleSpectrum,
  ringRadius,
  ringTunnelLength,
  ringTunnelZ,
  smoothBars,
  tunnelExtent,
  type ParticleDistribution,
} from "./math";

const DISTRIBUTIONS: ParticleDistribution[] = ["sphere", "shell", "cube", "disc", "spiral", "tunnel"];

describe("particle distributions", () => {
  it.each(DISTRIBUTIONS)("%s produces the requested count of finite points", (d) => {
    const { positions, randoms } = generateParticles(d, 500, 10, 7);
    expect(positions.length).toBe(1500);
    expect(randoms.length).toBe(2000);
    for (const v of positions) expect(Number.isFinite(v)).toBe(true);
    for (const v of randoms) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("sphere points stay within the spread radius", () => {
    const { positions } = generateParticles("sphere", 2000, 5, 3);
    for (let i = 0; i < positions.length; i += 3) {
      expect(Math.hypot(positions[i], positions[i + 1], positions[i + 2])).toBeLessThanOrEqual(5 + 1e-4);
    }
  });

  it("shell points sit near the surface", () => {
    const { positions } = generateParticles("shell", 1000, 8, 3);
    for (let i = 0; i < positions.length; i += 3) {
      const r = Math.hypot(positions[i], positions[i + 1], positions[i + 2]);
      expect(r).toBeGreaterThan(8 * 0.93);
      expect(r).toBeLessThanOrEqual(8 + 1e-4);
    }
  });

  it("cube points stay inside the half-extent", () => {
    const { positions } = generateParticles("cube", 1000, 4, 9);
    for (const v of positions) expect(Math.abs(v)).toBeLessThanOrEqual(4);
  });

  it("disc is flat compared to its radius", () => {
    const { positions } = generateParticles("disc", 2000, 10, 11);
    let maxY = 0;
    for (let i = 0; i < positions.length; i += 3) maxY = Math.max(maxY, Math.abs(positions[i + 1]));
    expect(maxY).toBeLessThan(1);
  });

  it("tunnel points lie in the tunnel depth range", () => {
    const { zMin, zMax } = tunnelExtent(6);
    const { positions } = generateParticles("tunnel", 1000, 6, 5);
    for (let i = 0; i < positions.length; i += 3) {
      expect(positions[i + 2]).toBeGreaterThanOrEqual(zMin);
      expect(positions[i + 2]).toBeLessThanOrEqual(zMax);
    }
  });

  it("is deterministic for a seed", () => {
    const a = generateParticles("spiral", 100, 10, hashString("lyr_abc"));
    const b = generateParticles("spiral", 100, 10, hashString("lyr_abc"));
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
  });

  it("mulberry32 returns values in [0, 1)", () => {
    const r = mulberry32(42);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("spectrum resampling", () => {
  it("resamples a ramp to fewer bars preserving endpoints", () => {
    const src = Float32Array.from({ length: 64 }, (_, i) => i / 63);
    const out = resampleSpectrum(src, new Float32Array(8), false);
    expect(out[0]).toBeCloseTo(0);
    expect(out[7]).toBeCloseTo(1);
    for (let i = 1; i < 8; i++) expect(out[i]).toBeGreaterThan(out[i - 1]);
  });

  it("upsamples with interpolation", () => {
    const src = Float32Array.from([0, 1]);
    const out = resampleSpectrum(src, new Float32Array(5), false);
    expect(Array.from(out)).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });

  it("mirror produces a symmetric sequence", () => {
    const src = Float32Array.from({ length: 64 }, (_, i) => i / 63);
    for (const bars of [8, 9, 96, 128]) {
      const out = resampleSpectrum(src, new Float32Array(bars), true);
      for (let i = 0; i < bars; i++) expect(out[i]).toBeCloseTo(out[bars - 1 - i]);
    }
  });

  it("clamps out-of-range input and handles empty sources", () => {
    const out = resampleSpectrum(Float32Array.from([2, -1]), new Float32Array(2), false);
    expect(Array.from(out)).toEqual([1, 0]);
    expect(Array.from(resampleSpectrum([], new Float32Array(3).fill(0.5), false))).toEqual([0, 0, 0]);
  });

  it("smoothBars approaches the target with fast attack and slow release", () => {
    const cur = new Float32Array([0, 1]);
    smoothBars(cur, new Float32Array([1, 0]), 1 / 60);
    expect(cur[0]).toBeGreaterThan(0.5);
    expect(cur[1]).toBeGreaterThan(0.5);
  });
});

describe("mapping application", () => {
  it("multiplies by (1 + m) and never goes negative", () => {
    expect(multiplyMod(2, 0)).toBe(2);
    expect(multiplyMod(2, 0.5)).toBe(3);
    expect(multiplyMod(2, -2)).toBe(0);
  });

  it("clamps opacity to 0..1", () => {
    expect(opacityMod(0.5, 0.5)).toBe(0.75);
    expect(opacityMod(0.8, 1)).toBe(1);
    expect(opacityMod(0.8, -3)).toBe(0);
  });

  it("hue shift is m x 0.5 turns", () => {
    expect(hueTurns(1)).toBe(0.5);
    expect(hueTurns(-0.4)).toBeCloseTo(-0.2);
  });
});

describe("ring placement", () => {
  it("concentric rings grow by spacing", () => {
    expect(ringRadius("concentric", 0, 2, 0.5)).toBe(2);
    expect(ringRadius("concentric", 3, 2, 0.5)).toBe(3.5);
    expect(ringRadius("tunnel", 3, 2, 0.5)).toBe(2);
  });

  it("tunnel rings stay within the tunnel length and flow forward", () => {
    const len = ringTunnelLength(10, 2);
    for (let t = 0; t < 5; t += 0.37) {
      for (let i = 0; i < 10; i++) {
        const z = ringTunnelZ(i, 10, 2, t);
        expect(z).toBeLessThanOrEqual(len * 0.15 + 1e-6);
        expect(z).toBeGreaterThan(len * 0.15 - len - 1e-6);
      }
    }
    // A ring away from the wrap point moves towards +z as time advances.
    expect(ringTunnelZ(5, 10, 2, 0.5)).toBeGreaterThan(ringTunnelZ(5, 10, 2, 0));
  });
});

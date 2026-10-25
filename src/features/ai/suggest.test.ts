import { describe, expect, it } from "vitest";
import type { AudioProfile } from "@/shared/audio/contract";
import { suggestStyles } from "./suggest";

const base: AudioProfile = {
  source: "file",
  analyzedSec: 30,
  durationSec: 200,
  avgEnergy: 0.55,
  peakEnergy: 0.9,
  bassRatio: 0.5,
  midsRatio: 0.3,
  highsRatio: 0.2,
  onsetRate: 2.2,
  tempoBpm: 128,
  dynamics: 0.4,
};

describe("suggestStyles", () => {
  it("is empty without analysis", () => {
    expect(suggestStyles(null)).toEqual([]);
    expect(suggestStyles({ ...base, analyzedSec: 1 })).toEqual([]);
  });

  it("suggests a pulsing tunnel for bass-heavy fast music", () => {
    const [first] = suggestStyles(base);
    expect(first.id).toBe("bass-tunnel");
    expect(first.reason).toBe("Bass-heavy, ~128 BPM");
  });

  it("returns at most 3 deterministic suggestions with no emotion claims", () => {
    const profiles: AudioProfile[] = [
      base,
      { ...base, tempoBpm: 80, avgEnergy: 0.15, bassRatio: 0.2, midsRatio: 0.5, highsRatio: 0.3 },
      { ...base, tempoBpm: null, bassRatio: 0.33, midsRatio: 0.34, highsRatio: 0.33, onsetRate: 1, avgEnergy: 0.3 },
      { ...base, onsetRate: 6, highsRatio: 0.4, bassRatio: 0.3 },
    ];
    for (const p of profiles) {
      const list = suggestStyles(p);
      expect(list.length).toBeGreaterThan(0);
      expect(list.length).toBeLessThanOrEqual(3);
      expect(suggestStyles(p)).toEqual(list);
      for (const s of list) expect(`${s.label} ${s.reason}`).not.toMatch(/\b(sad|happy|angry|emotion|mood)\b/i);
    }
  });
});

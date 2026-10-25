/**
 * Prompt ideas derived from measured music features (band balance, tempo,
 * energy, onset density). Pure and deterministic. Describes the signal only —
 * never claims to recognise emotion.
 */
import type { StyleSuggestion } from "@/shared/ai/contract";
import type { AudioProfile } from "@/shared/audio/contract";

const MIN_ANALYZED_SEC = 3;

export function suggestStyles(profile: AudioProfile | null | undefined): StyleSuggestion[] {
  if (!profile || profile.analyzedSec < MIN_ANALYZED_SEC) return [];
  const bpm = profile.tempoBpm != null ? Math.round(profile.tempoBpm) : null;
  const tempo = bpm ? `~${bpm} BPM` : null;
  const fast = bpm != null && bpm >= 118;
  const slow = (bpm != null && bpm < 95) || profile.avgEnergy < 0.22;
  const bassHeavy = profile.bassRatio >= 0.45;
  const bright = profile.highsRatio >= 0.3;
  const midFocused = profile.midsRatio >= 0.45;
  const busy = profile.onsetRate >= 3;
  const energetic = profile.avgEnergy >= 0.5;
  const why = (...parts: (string | null | false)[]) => parts.filter(Boolean).join(", ");

  const out: (StyleSuggestion & { score: number })[] = [];
  if (bassHeavy && !slow)
    out.push({ id: "bass-tunnel", label: "Pulsing tunnel", prompt: "A neon tunnel with rings that pulse hard on the kick and particles rushing forward, strong bass reactions", reason: why("Bass-heavy", tempo), score: 3 + profile.bassRatio });
  if (bassHeavy && slow)
    out.push({ id: "bass-monolith", label: "Heavy monolith", prompt: "A dark metallic monolith that swells with the sub-bass in thick fog, slow camera, gentle reactions", reason: why("Bass-heavy", tempo ?? "low energy"), score: 3 + profile.bassRatio });
  if (bright)
    out.push({ id: "bright-stars", label: "Shimmering stars", prompt: "A shimmering star field with crystal shards that sparkle with the hi-hats", reason: why("Bright high end", tempo), score: 2 + profile.highsRatio * 2 });
  if (midFocused)
    out.push({ id: "mid-halo", label: "Melodic halo", prompt: "A circular spectrum halo with soft rings that follow the melody, smooth motion", reason: why("Mid-range focused", tempo), score: 2 + profile.midsRatio });
  if (busy || (fast && energetic))
    out.push({ id: "beat-grid", label: "Beat-synced grid", prompt: "A retro synthwave grid that jumps on every beat with camera shake and a glowing sun", reason: why(busy ? `${profile.onsetRate.toFixed(1)} onsets/s` : "High energy", tempo), score: 2 + Math.min(1, profile.onsetRate / 6) });
  if (slow)
    out.push({ id: "ambient-nebula", label: "Nebula drift", prompt: "A slow spiral galaxy in a violet nebula with gentle, smooth reactions", reason: why("Low energy", tempo), score: 1.5 + (1 - profile.avgEnergy) });
  if (out.length === 0)
    out.push({ id: "balanced-core", label: "Crystal core", prompt: "A distorting crystal core with orbiting shards and a halo, balanced reactions to bass and highs", reason: why("Balanced mix", tempo), score: 1 });
  return out
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(({ id, label, prompt, reason }) => ({ id, label, prompt, reason }));
}

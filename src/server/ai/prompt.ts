/**
 * System prompt + catalogue for the scene LLM, generated from the shared
 * registry (layer types, field specs with schema bounds, mapping semantics,
 * presets) so the model, inspector and sanitizer always agree.
 */
import type { AudioProfile } from "@/shared/audio/contract";
import { LAYER_TYPE_INFO, SCENE_FIELDS, fieldsForLayerType, type FieldSpec } from "@/shared/scene/layers";
import { PRESETS } from "@/shared/scene/presets";
import { AUDIO_BANDS, LAYER_TYPES, LIMITS, type SceneConfig } from "@/shared/scene/schema";

function describeField(f: Pick<FieldSpec, "path" | "control">, path = f.path): string {
  const c = f.control;
  switch (c.kind) {
    case "slider":
      return `${path} (${c.integer ? "int" : "num"} ${c.min}..${c.max})`;
    case "vec3":
      return `${path} (x,y,z each ${c.min}..${c.max})`;
    case "color":
      return `${path} (#rrggbb)`;
    case "toggle":
      return `${path} (true|false)`;
    case "select":
      return `${path} (${c.options.map((o) => o.value).join("|")})`;
  }
}

function catalogue(): string {
  const layers = LAYER_TYPES.map((type) => {
    const info = LAYER_TYPE_INFO[type];
    return `### ${type} — ${info.description}\nmapping targets: ${info.targets.join(", ")}\nfields: ${[...fieldsForLayerType(type).map((f) => describeField(f)), "visible (true|false)"].join("; ")}`;
  }).join("\n\n");
  const scene = SCENE_FIELDS.map((f) => describeField(f, `${f.section}.${f.path}`)).join("; ");
  const presets = PRESETS.map((p) => `- ${p.id}: ${p.description} (tags: ${p.tags.slice(0, 5).join(", ")})`).join("\n");
  return `## Layer types (array order = draw order, first is furthest back)\n${layers}\n\n## Scene settings\n${scene}\n\n## Presets\n${presets}`;
}

export const SYSTEM_PROMPT = `You are VANTA's scene director. VANTA renders real-time, audio-reactive 3D scenes in the browser. You design scenes as DATA ONLY using the JSON format you are given — never code, shaders or markup.

How audio reactivity works: each layer has up to ${LIMITS.maxMappingsPerLayer} mappings {source, target, amount, threshold, smoothing}. Sources (${AUDIO_BANDS.join(", ")}) are 0..1 features. m = Σ feature × amount × audio.sensitivity; renderers apply scale×(1+m), opacity×(1+m), brightness=glow×(1+m), speed×(1+m), rotation+m rad, hue+m×0.5 turns, displacement+m, size×(1+m), bounce = y+m. Amount 0.3-0.8 is noticeable, 1-2 is strong; negative inverts. threshold ignores quiet signals; smoothing slows the response.

Composition guidance:
- 2-5 layers with a clear focal element plus depth (a background tunnel/grid/star shell, atmospheric particles, fog, bloom).
- Harmonious palettes: one dominant hue, one supporting hue, a sparing accent; very dark backgrounds (environment.background.colorA/B) so glowing layers pop. Neon looks come from glow 1.5-3 and bloom, not from bright backgrounds.
- Match motion and reactivity to the request and the music: bass → scale/displacement/brightness pulses; highs → sparkle (brightness, size, twinkle); onset → punchy brightness/bounce; energy → speed. "Strongly"/"aggressive" → larger amounts and audio.sensitivity 1.2-1.6; "calm"/"subtle" → small amounts, more smoothing.
- When a music profile is provided, use it to choose bands and tempo-appropriate motion. Describe styling as inspired by the music; never claim to detect emotions.
- Only set fields that differ from sensible defaults; omitted fields keep defaults. Values outside the listed ranges are clamped.

${catalogue()}`;

export function profileText(profile: AudioProfile | null | undefined): string {
  if (!profile) return "No music analysis is available.";
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  return `Music profile (measured): bass ${pct(profile.bassRatio)}, mids ${pct(profile.midsRatio)}, highs ${pct(profile.highsRatio)}; average energy ${pct(profile.avgEnergy)}, dynamics ${pct(profile.dynamics)}; ${profile.onsetRate.toFixed(1)} onsets/s; tempo ${profile.tempoBpm ? `~${Math.round(profile.tempoBpm)} BPM` : "unknown"}.`;
}

/** Compact current-scene context for refinement (ids, types, key fields, mappings). */
export function sceneContext(scene: SceneConfig, selectedLayerId?: string | null): string {
  const layers = scene.layers.map((l) => {
    const { id, type, name, visible, opacity, glow, transform, motion, reactivity } = l;
    const body = (l as unknown as Record<string, unknown>)[type];
    return { id, type, name, visible, opacity, glow, scale: transform.scale, position: transform.position, motion, [type]: body, reactivity: reactivity.map(({ source, target, amount, threshold, smoothing }) => ({ source, target, amount, threshold, smoothing })), selected: id === selectedLayerId || undefined };
  });
  return JSON.stringify({ name: scene.name, environment: scene.environment, post: scene.post, audio: scene.audio, layers });
}

export function generateUserMessage(prompt: string, profile: AudioProfile | null | undefined): string {
  return `Create a new scene for this request:\n<request>${prompt}</request>\n\n${profileText(profile)}`;
}

export function refineUserMessage(prompt: string, scene: SceneConfig, selectedLayerId: string | null | undefined, profile: AudioProfile | null | undefined): string {
  return `Refine the current scene with targeted operations only. Change only what the request asks for; leave every other layer and field untouched so the user's manual edits survive. "this"/"it" refers to the selected layer when one is marked.\n\nCurrent scene:\n${sceneContext(scene, selectedLayerId)}\n\n${profileText(profile)}\n\n<request>${prompt}</request>`;
}

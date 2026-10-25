/**
 * Compact "draft" format the LLM produces, plus its expansion into real scene
 * data. Every editable field is addressed by a registry path ("rings.sides",
 * "environment.fog.density") with a string value; values are coerced and
 * clamped using the inspector field specs (which read bounds from the canonical
 * Zod schema). Unknown paths, layer types, colours or code-like strings are
 * dropped with a warning. The model never produces code — only these settings.
 */
import { normalizeHexColor } from "@/shared/utils/color";
import { isPlainObject, setAtPath } from "@/shared/utils/object";
import { createLayer, createMapping, createScene } from "@/shared/scene/defaults";
import { SCENE_FIELDS, fieldsForLayerType, layerSupportsTarget, type FieldSpec } from "@/shared/scene/layers";
import { PRESETS } from "@/shared/scene/presets";
import { sanitizeSceneConfig } from "@/shared/scene/sanitize";
import type { ScenePatch, ScenePatchOp } from "@/shared/scene/patch";
import {
  AUDIO_BANDS,
  IdSchema,
  LAYER_TYPES,
  LIMITS,
  MAPPING_TARGETS,
  type AudioMapping,
  type Layer,
  type LayerType,
  type SceneConfig,
} from "@/shared/scene/schema";
import { cleanText } from "./text";

/* ------------------------------------------------------------------ */
/* Field registry views                                                */
/* ------------------------------------------------------------------ */

const VISIBLE_FIELD: FieldSpec = { path: "visible", label: "Visible", group: "Layer", control: { kind: "toggle" } };

export const LAYER_FIELD_SPECS: Record<LayerType, Map<string, FieldSpec>> = Object.fromEntries(
  LAYER_TYPES.map((type) => [type, new Map([...fieldsForLayerType(type), VISIBLE_FIELD].map((f) => [f.path, f]))]),
) as Record<LayerType, Map<string, FieldSpec>>;

/** Every layer path across all types (for the JSON-schema enum). */
export const ALL_LAYER_PATHS: string[] = [...new Set(LAYER_TYPES.flatMap((t) => [...LAYER_FIELD_SPECS[t].keys()]))];

/** Scene-level paths prefixed with their section: "environment.fog.density", "post.bloom.intensity", "audio.sensitivity". */
export const SCENE_FIELD_SPECS: Map<string, FieldSpec & { section: "environment" | "post" | "audio" }> = new Map(
  SCENE_FIELDS.map((f) => [`${f.section}.${f.path}`, { ...f, group: "Layer" as const, section: f.section }]),
);
export const ALL_SCENE_PATHS: string[] = [...SCENE_FIELD_SPECS.keys()];

export const PRESET_IDS: string[] = ["custom", ...PRESETS.map((p) => p.id)];

/* ------------------------------------------------------------------ */
/* Draft types + JSON schemas (structured outputs)                     */
/* ------------------------------------------------------------------ */

export interface SettingDraft {
  path: string;
  value: string;
}
export interface MappingDraft {
  source: string;
  target: string;
  amount: number;
  threshold: number;
  smoothing: number;
}
export interface LayerDraft {
  type: string;
  name: string;
  settings: SettingDraft[];
  reactivity: MappingDraft[];
}
export interface SceneDraft {
  name: string;
  summary: string;
  preset: string;
  settings: SettingDraft[];
  layers: LayerDraft[];
}
export const REFINE_OP_KINDS = ["updateLayer", "addLayer", "removeLayer", "updateScene", "renameScene"] as const;
export interface RefineOpDraft {
  op: string;
  layerId: string;
  layerType: string;
  name: string;
  settings: SettingDraft[];
  replaceReactivity: boolean;
  reactivity: MappingDraft[];
}
export interface RefineDraft {
  summary: string;
  ops: RefineOpDraft[];
}

const obj = (properties: Record<string, unknown>, description?: string) => ({
  type: "object",
  ...(description ? { description } : {}),
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const str = (description?: string) => ({ type: "string", ...(description ? { description } : {}) });
const num = (description?: string) => ({ type: "number", ...(description ? { description } : {}) });
const strEnum = (values: readonly string[], description?: string) => ({ type: "string", enum: [...values], ...(description ? { description } : {}) });
const arr = (items: unknown, description?: string) => ({ type: "array", items, ...(description ? { description } : {}) });

const settingSchema = (paths: string[], description: string) =>
  obj(
    {
      path: strEnum(paths, "Field path from the catalogue"),
      value: str("Number as decimal text, colour as #rrggbb, boolean as true/false, option name, or vec3 as x,y,z"),
    },
    description,
  );

const mappingSchema = obj({
  source: strEnum(AUDIO_BANDS),
  target: strEnum(MAPPING_TARGETS),
  amount: num("-3..3"),
  threshold: num("0..0.95"),
  smoothing: num("0..0.99"),
});

export const SCENE_DRAFT_JSON_SCHEMA = obj({
  name: str("Evocative scene name, max 48 characters"),
  summary: str("One or two sentences describing the scene for the user"),
  preset: strEnum(PRESET_IDS, "Closest preset id, or custom"),
  settings: arr(settingSchema(ALL_SCENE_PATHS, "Scene-level setting"), "Environment / post / audio settings that differ from the defaults"),
  layers: arr(
    obj({
      type: strEnum(LAYER_TYPES),
      name: str("Short layer name"),
      settings: arr(settingSchema(ALL_LAYER_PATHS, "Layer setting valid for this layer type"), "Only fields that differ from the type defaults"),
      reactivity: arr(mappingSchema, "Audio mappings (max 6); targets must be supported by the layer type"),
    }),
    "Layers in draw order (first = furthest back), 2-5 recommended, max 12",
  ),
});

export const REFINE_DRAFT_JSON_SCHEMA = obj({
  summary: str("One or two sentences describing what changed"),
  ops: arr(
    obj({
      op: strEnum(REFINE_OP_KINDS),
      layerId: str("Existing layer id for updateLayer/removeLayer, otherwise empty"),
      layerType: strEnum([...LAYER_TYPES, "none"], "Layer type for addLayer, otherwise none"),
      name: str("New layer name (addLayer / optional rename for updateLayer) or new scene name (renameScene); empty when unused"),
      settings: arr(
        settingSchema([...ALL_LAYER_PATHS, ...ALL_SCENE_PATHS], "Layer paths for updateLayer/addLayer, scene paths for updateScene"),
        "Only the fields that must change",
      ),
      replaceReactivity: { type: "boolean", description: "true to replace the layer's audio mappings with `reactivity`" },
      reactivity: arr(mappingSchema, "Full new mapping list when replaceReactivity is true (addLayer: the new layer's mappings)"),
    }),
    "Targeted operations; leave unrelated layers and fields untouched",
  ),
});

/* ------------------------------------------------------------------ */
/* Value coercion                                                      */
/* ------------------------------------------------------------------ */

type Coerced = { ok: true; value: unknown } | { ok: false; reason: string };

const CODE_LIKE = /[<>{}`;]|=>|\bfunction\b|\bimport\b|\beval\b|\bscript\b/i;

export function coerceFieldValue(spec: FieldSpec, raw: unknown): Coerced {
  const text = typeof raw === "string" ? raw.trim() : typeof raw === "number" || typeof raw === "boolean" ? String(raw) : null;
  if (text === null || text.length === 0 || text.length > 64) return { ok: false, reason: "missing or oversized value" };
  if (CODE_LIKE.test(text) && spec.control.kind !== "color") return { ok: false, reason: "not a plain value" };
  const control = spec.control;
  switch (control.kind) {
    case "slider": {
      const n = Number(text);
      if (!Number.isFinite(n)) return { ok: false, reason: `"${text.slice(0, 20)}" is not a number` };
      let v = Math.min(control.max, Math.max(control.min, n));
      if (control.integer) v = Math.round(v);
      return { ok: true, value: v };
    }
    case "vec3": {
      const parts = text.replace(/[[\]()]/g, "").split(/[\s,]+/).filter(Boolean).map(Number);
      if (parts.length !== 3 || parts.some((p) => !Number.isFinite(p))) return { ok: false, reason: "expected x,y,z" };
      return { ok: true, value: parts.map((p) => Math.min(control.max, Math.max(control.min, p))) };
    }
    case "color": {
      const color = normalizeHexColor(text);
      return color ? { ok: true, value: color } : { ok: false, reason: `"${text.slice(0, 20)}" is not a colour` };
    }
    case "toggle": {
      const t = text.toLowerCase();
      if (["true", "1", "yes", "on"].includes(t)) return { ok: true, value: true };
      if (["false", "0", "no", "off"].includes(t)) return { ok: true, value: false };
      return { ok: false, reason: "expected true/false" };
    }
    case "select": {
      const match = control.options.find((o) => o.value.toLowerCase() === text.toLowerCase());
      return match ? { ok: true, value: match.value } : { ok: false, reason: `"${text.slice(0, 20)}" is not an option` };
    }
  }
}

/** Applies validated settings onto a plain object (paths resolved against `specs`). */
export function applySettings(
  target: Record<string, unknown>,
  settings: unknown,
  resolve: (path: string) => FieldSpec | undefined,
  where: string,
  warnings: string[],
  pathPrefix = "",
): Record<string, unknown> {
  if (!Array.isArray(settings)) return target;
  let out = target;
  for (const raw of settings.slice(0, 80)) {
    if (!isPlainObject(raw) || typeof raw.path !== "string") continue;
    const spec = resolve(raw.path);
    if (!spec) {
      warnings.push(`${where}: ignored unknown setting "${String(raw.path).slice(0, 40)}"`);
      continue;
    }
    const coerced = coerceFieldValue(spec, raw.value);
    if (!coerced.ok) {
      warnings.push(`${where}: ignored ${raw.path} (${coerced.reason})`);
      continue;
    }
    out = setAtPath(out, `${pathPrefix}${spec.path}`, coerced.value);
  }
  return out;
}

export function draftMappings(type: LayerType, raw: unknown, where: string, warnings: string[]): AudioMapping[] {
  if (!Array.isArray(raw)) return [];
  const out: AudioMapping[] = [];
  for (const m of raw) {
    if (!isPlainObject(m)) continue;
    const source = (AUDIO_BANDS as readonly string[]).includes(m.source as string) ? (m.source as AudioMapping["source"]) : null;
    const target = (MAPPING_TARGETS as readonly string[]).includes(m.target as string) ? (m.target as AudioMapping["target"]) : null;
    if (!source || !target) {
      warnings.push(`${where}: dropped mapping with unknown source/target`);
      continue;
    }
    if (!layerSupportsTarget(type, target)) {
      warnings.push(`${where}: dropped ${source}→${target} (${type} layers do not support it)`);
      continue;
    }
    const n = (v: unknown, min: number, max: number, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback);
    out.push(
      createMapping({
        source,
        target,
        amount: n(m.amount, -3, 3, 0.6),
        threshold: n(m.threshold, 0, 0.95, 0),
        smoothing: n(m.smoothing, 0, 0.99, 0.2),
      }),
    );
    if (out.length >= LIMITS.maxMappingsPerLayer) break;
  }
  return out;
}

function layerTypeOf(raw: unknown): LayerType | null {
  return typeof raw === "string" && (LAYER_TYPES as readonly string[]).includes(raw) ? (raw as LayerType) : null;
}

/** Builds a complete, valid layer from a draft (or null for unsupported types). */
export function expandLayerDraft(raw: unknown, index: number, warnings: string[]): Layer | null {
  if (!isPlainObject(raw)) return null;
  const type = layerTypeOf(raw.type);
  const where = `layer ${index + 1}`;
  if (!type) {
    warnings.push(`${where}: dropped unsupported layer type ${JSON.stringify(raw.type)?.slice(0, 30)}`);
    return null;
  }
  const specs = LAYER_FIELD_SPECS[type];
  const overrides = applySettings({}, raw.settings, (p) => specs.get(p), where, warnings);
  const name = cleanText(raw.name, LIMITS.maxNameLength);
  if (name) overrides.name = name;
  const layer = createLayer(type, overrides as Parameters<typeof createLayer>[1]);
  if (Array.isArray(raw.reactivity)) layer.reactivity = draftMappings(type, raw.reactivity, where, warnings);
  return layer;
}

type SceneSections = Record<"environment" | "post" | "audio", Record<string, unknown>>;

/** Validates section-prefixed scene settings and groups them per section. */
export function groupSceneSettings(settings: unknown, where: string, warnings: string[]): SceneSections {
  const grouped: SceneSections = { environment: {}, post: {}, audio: {} };
  if (!Array.isArray(settings)) return grouped;
  for (const s of settings.slice(0, 80)) {
    if (!isPlainObject(s) || typeof s.path !== "string") continue;
    const spec = SCENE_FIELD_SPECS.get(s.path);
    if (!spec) {
      warnings.push(`${where}: ignored unknown scene setting "${s.path.slice(0, 40)}"`);
      continue;
    }
    const coerced = coerceFieldValue(spec, s.value);
    if (!coerced.ok) {
      warnings.push(`${where}: ignored ${s.path} (${coerced.reason})`);
      continue;
    }
    grouped[spec.section] = setAtPath(grouped[spec.section], spec.path, coerced.value);
  }
  return grouped;
}

/* ------------------------------------------------------------------ */
/* Scene draft → SceneConfig                                           */
/* ------------------------------------------------------------------ */

export interface ExpandedScene {
  scene: SceneConfig;
  summary: string;
  warnings: string[];
}

export function expandSceneDraft(data: unknown, prompt: string): ExpandedScene | null {
  if (!isPlainObject(data)) return null;
  const warnings: string[] = [];
  const rawLayers = Array.isArray(data.layers) ? data.layers : [];
  const layers: Layer[] = [];
  rawLayers.slice(0, LIMITS.maxLayers).forEach((raw, i) => {
    const layer = expandLayerDraft(raw, i, warnings);
    if (layer) layers.push(layer);
  });
  if (rawLayers.length > LIMITS.maxLayers) warnings.push(`Trimmed to ${LIMITS.maxLayers} layers.`);
  if (layers.length === 0) return null;

  const grouped = groupSceneSettings(data.settings, "scene", warnings);

  const preset = typeof data.preset === "string" && PRESET_IDS.includes(data.preset) ? data.preset : "custom";
  const name = cleanText(data.name, LIMITS.maxNameLength) || "AI Scene";
  const draftScene = createScene({
    name,
    preset,
    origin: "ai",
    prompt: prompt.slice(0, LIMITS.maxPromptLength),
    layers,
    environment: grouped.environment,
    post: grouped.post,
    audio: grouped.audio,
  });
  const sanitized = sanitizeSceneConfig(draftScene);
  if (!sanitized.ok) return null;
  warnings.push(...sanitized.warnings);
  return { scene: sanitized.value, summary: cleanText(data.summary, 600), warnings };
}

/* ------------------------------------------------------------------ */
/* Refine draft → ScenePatch                                           */
/* ------------------------------------------------------------------ */

export interface ExpandedPatch {
  patch: ScenePatch;
  summary: string;
  warnings: string[];
}

export function expandRefineDraft(data: unknown, scene: SceneConfig): ExpandedPatch | null {
  if (!isPlainObject(data) || !Array.isArray(data.ops)) return null;
  const warnings: string[] = [];
  const ops: ScenePatchOp[] = [];
  const layerById = new Map(scene.layers.map((l) => [l.id, l]));

  data.ops.slice(0, 40).forEach((raw, i) => {
    if (!isPlainObject(raw)) return;
    const where = `op ${i + 1}`;
    switch (raw.op) {
      case "updateLayer": {
        const layer = typeof raw.layerId === "string" ? layerById.get(raw.layerId) : undefined;
        if (!layer) return void warnings.push(`${where}: unknown layer ${JSON.stringify(raw.layerId)?.slice(0, 30)}`);
        const specs = LAYER_FIELD_SPECS[layer.type];
        const changes = applySettings({}, raw.settings, (p) => specs.get(p), `${where} (${layer.name})`, warnings);
        const name = cleanText(raw.name, LIMITS.maxNameLength);
        if (name && name !== layer.name) changes.name = name;
        if (raw.replaceReactivity === true) changes.reactivity = draftMappings(layer.type, raw.reactivity, where, warnings);
        if (Object.keys(changes).length > 0) ops.push({ op: "updateLayer", layerId: layer.id, changes });
        return;
      }
      case "addLayer": {
        const layer = expandLayerDraft({ type: raw.layerType, name: raw.name, settings: raw.settings, reactivity: raw.replaceReactivity === true || (Array.isArray(raw.reactivity) && raw.reactivity.length > 0) ? raw.reactivity : undefined }, i, warnings);
        if (layer) ops.push({ op: "addLayer", layer: layer as unknown as Record<string, unknown> });
        return;
      }
      case "removeLayer": {
        if (typeof raw.layerId === "string" && layerById.has(raw.layerId) && IdSchema.safeParse(raw.layerId).success) ops.push({ op: "removeLayer", layerId: raw.layerId });
        else warnings.push(`${where}: unknown layer to remove`);
        return;
      }
      case "updateScene": {
        const grouped = groupSceneSettings(raw.settings, where, warnings);
        if (Object.keys(grouped.environment).length) ops.push({ op: "updateEnvironment", changes: grouped.environment });
        if (Object.keys(grouped.post).length) ops.push({ op: "updatePost", changes: grouped.post });
        if (Object.keys(grouped.audio).length) ops.push({ op: "updateAudio", changes: grouped.audio });
        return;
      }
      case "renameScene": {
        const name = cleanText(raw.name, LIMITS.maxNameLength);
        if (name) ops.push({ op: "renameScene", name });
        return;
      }
      default:
        warnings.push(`${where}: ignored unsupported operation`);
    }
  });
  return { patch: { ops }, summary: cleanText(data.summary, 600), warnings };
}

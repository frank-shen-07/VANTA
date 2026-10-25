/**
 * Layer-type registry — owned by the lead orchestrator.
 *
 * Describes every renderable layer type: label, supported audio-mapping targets
 * and the editable fields the Properties Inspector must expose. Slider bounds
 * are read from the Zod schema, so the inspector, the sanitizer and the AI
 * JSON Schema always agree.
 */
import type { z } from "zod";
import {
  EnvironmentSchema,
  GridLayerSchema,
  ParticlesLayerSchema,
  PostSchema,
  RingsLayerSchema,
  SceneAudioSettingsSchema,
  ShapeLayerSchema,
  SpectrumLayerSchema,
  TunnelLayerSchema,
  type LayerType,
  type MappingTarget,
} from "./schema";

export const LAYER_SCHEMAS = {
  particles: ParticlesLayerSchema,
  rings: RingsLayerSchema,
  shape: ShapeLayerSchema,
  tunnel: TunnelLayerSchema,
  grid: GridLayerSchema,
  spectrum: SpectrumLayerSchema,
} as const satisfies Record<LayerType, z.ZodType>;

export interface LayerTypeInfo {
  type: LayerType;
  label: string;
  description: string;
  /** lucide-react icon name. */
  icon: string;
  /** Audio-mapping targets this layer type implements. */
  targets: readonly MappingTarget[];
}

export const LAYER_TYPE_INFO: Record<LayerType, LayerTypeInfo> = {
  particles: {
    type: "particles",
    label: "Particles",
    description: "GPU point cloud: spheres, shells, discs, spirals or tunnels of glowing particles.",
    icon: "Sparkles",
    targets: ["scale", "opacity", "brightness", "speed", "rotation", "hue", "displacement", "size", "bounce"],
  },
  rings: {
    type: "rings",
    label: "Rings",
    description: "Glowing polygonal rings arranged as a tunnel, concentric halo or orbit.",
    icon: "CircleDot",
    targets: ["scale", "opacity", "brightness", "speed", "rotation", "hue", "displacement", "size", "bounce"],
  },
  shape: {
    type: "shape",
    label: "Shape",
    description: "Animated geometric solids with metallic/emissive materials and organic distortion.",
    icon: "Hexagon",
    targets: ["scale", "opacity", "brightness", "speed", "rotation", "hue", "displacement", "bounce"],
  },
  tunnel: {
    type: "tunnel",
    label: "Tunnel",
    description: "Endless striped or wireframe tunnel flowing towards the camera.",
    icon: "Orbit",
    targets: ["scale", "opacity", "brightness", "speed", "rotation", "hue", "displacement"],
  },
  grid: {
    type: "grid",
    label: "Grid",
    description: "Retro horizon grid with a rolling terrain wave.",
    icon: "Grid3x3",
    targets: ["opacity", "brightness", "speed", "hue", "displacement", "bounce"],
  },
  spectrum: {
    type: "spectrum",
    label: "Spectrum",
    description: "Frequency bars driven directly by the live audio spectrum.",
    icon: "AudioLines",
    targets: ["scale", "opacity", "brightness", "rotation", "hue", "displacement", "bounce"],
  },
};

export function layerSupportsTarget(type: LayerType, target: MappingTarget): boolean {
  return LAYER_TYPE_INFO[type].targets.includes(target);
}

/* ------------------------------------------------------------------ */
/* Inspector field specs                                               */
/* ------------------------------------------------------------------ */

export type FieldControl =
  | { kind: "slider"; min: number; max: number; step: number; integer: boolean; unit?: string }
  | { kind: "vec3"; min: number; max: number; step: number; unit?: string }
  | { kind: "color" }
  | { kind: "toggle" }
  | { kind: "select"; options: readonly { value: string; label: string }[] };

export type FieldGroup = "Layer" | "Geometry" | "Colour" | "Material" | "Transform" | "Motion";

export interface FieldSpec {
  /** Dot path inside the layer / environment / post object, e.g. "particles.count". */
  path: string;
  label: string;
  group: FieldGroup;
  control: FieldControl;
  hint?: string;
  /** Changing this re-creates GPU buffers (e.g. particle count); UI may debounce. */
  rebuilds?: boolean;
}

type AnySchema = z.ZodType & { _zod: { def: Record<string, unknown> } };

function schemaAtPath(root: z.ZodType, path: string): AnySchema {
  let cur = root as AnySchema;
  for (const key of path.split(".")) {
    const def = cur._zod.def as { type: string; shape?: Record<string, AnySchema>; items?: AnySchema[] };
    if (def.type === "object" && def.shape) cur = def.shape[key];
    else if (def.type === "tuple" && def.items) cur = def.items[Number(key)];
    else throw new Error(`Cannot resolve schema path "${path}" at "${key}"`);
    if (!cur) throw new Error(`Unknown schema path "${path}"`);
  }
  return cur;
}

/** Numeric bounds of a schema field, read from the canonical Zod schema. */
export function numberBounds(root: z.ZodType, path: string): { min: number; max: number; integer: boolean } {
  let s = schemaAtPath(root, path) as AnySchema & { minValue?: number | null; maxValue?: number | null; isInt?: boolean };
  if ((s._zod.def as { type: string }).type === "tuple") s = (s._zod.def as unknown as { items: (typeof s)[] }).items[0];
  if (s.minValue == null || s.maxValue == null) throw new Error(`Field "${path}" is not a bounded number`);
  return { min: s.minValue, max: s.maxValue, integer: Boolean(s.isInt) };
}

function enumOptions(root: z.ZodType, path: string): string[] {
  const s = schemaAtPath(root, path) as AnySchema & { options?: string[] };
  if (!s.options) throw new Error(`Field "${path}" is not an enum`);
  return s.options;
}

const titleCase = (s: string) => s.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());

function slider(root: z.ZodType, path: string, label: string, group: FieldGroup, extra: { step?: number; unit?: string; hint?: string; rebuilds?: boolean } = {}): FieldSpec {
  const { min, max, integer } = numberBounds(root, path);
  const step = extra.step ?? (integer ? 1 : Math.max(0.001, Number(((max - min) / 200).toPrecision(1))));
  return { path, label, group, hint: extra.hint, rebuilds: extra.rebuilds, control: { kind: "slider", min, max, step, integer, unit: extra.unit } };
}
function vec3(root: z.ZodType, path: string, label: string, group: FieldGroup, step: number, unit?: string): FieldSpec {
  const { min, max } = numberBounds(root, path);
  return { path, label, group, control: { kind: "vec3", min, max, step, unit } };
}
function color(path: string, label: string, group: FieldGroup = "Colour"): FieldSpec {
  return { path, label, group, control: { kind: "color" } };
}
function toggle(path: string, label: string, group: FieldGroup, hint?: string): FieldSpec {
  return { path, label, group, hint, control: { kind: "toggle" } };
}
function select(root: z.ZodType, path: string, label: string, group: FieldGroup, rebuilds?: boolean): FieldSpec {
  return {
    path,
    label,
    group,
    rebuilds,
    control: { kind: "select", options: enumOptions(root, path).map((value) => ({ value, label: titleCase(value) })) },
  };
}

/** Fields shared by all layer types (bounds identical across types). */
const P = ParticlesLayerSchema;
export const COMMON_LAYER_FIELDS: readonly FieldSpec[] = [
  slider(P, "opacity", "Opacity", "Layer"),
  slider(P, "glow", "Glow", "Layer", { hint: "Emissive intensity; high values bloom" }),
  select(P, "blending", "Blending", "Layer"),
  vec3(P, "transform.position", "Position", "Transform", 0.1),
  vec3(P, "transform.rotation", "Rotation", "Transform", 1, "°"),
  slider(P, "transform.scale", "Scale", "Transform", { step: 0.01 }),
  vec3(P, "motion.spin", "Spin", "Motion", 0.01, "rad/s"),
  slider(P, "motion.speed", "Animation speed", "Motion", { step: 0.01 }),
];

export const LAYER_TYPE_FIELDS: Record<LayerType, readonly FieldSpec[]> = {
  particles: [
    slider(P, "particles.count", "Count", "Geometry", { step: 100, rebuilds: true }),
    select(P, "particles.distribution", "Distribution", "Geometry", true),
    slider(P, "particles.spread", "Spread", "Geometry", { step: 0.1, rebuilds: true }),
    slider(P, "particles.size", "Size", "Geometry", { step: 0.005 }),
    slider(P, "particles.turbulence", "Turbulence", "Motion"),
    slider(P, "particles.twinkle", "Twinkle", "Motion"),
    color("particles.colorA", "Colour A"),
    color("particles.colorB", "Colour B"),
  ],
  rings: [
    slider(RingsLayerSchema, "rings.count", "Count", "Geometry", { rebuilds: true }),
    select(RingsLayerSchema, "rings.arrangement", "Arrangement", "Geometry"),
    slider(RingsLayerSchema, "rings.radius", "Radius", "Geometry", { step: 0.05 }),
    slider(RingsLayerSchema, "rings.spacing", "Spacing", "Geometry", { step: 0.05 }),
    slider(RingsLayerSchema, "rings.thickness", "Thickness", "Geometry", { step: 0.005 }),
    slider(RingsLayerSchema, "rings.sides", "Sides", "Geometry", { rebuilds: true, hint: "3 = triangle, 64 = circle" }),
    slider(RingsLayerSchema, "rings.wave", "Wave", "Motion"),
    color("rings.colorA", "Colour A"),
    color("rings.colorB", "Colour B"),
  ],
  shape: [
    select(ShapeLayerSchema, "shape.geometry", "Geometry", "Geometry", true),
    slider(ShapeLayerSchema, "shape.detail", "Detail", "Geometry", { rebuilds: true }),
    slider(ShapeLayerSchema, "shape.instances", "Instances", "Geometry", { rebuilds: true }),
    slider(ShapeLayerSchema, "shape.orbitRadius", "Orbit radius", "Geometry", { step: 0.1 }),
    slider(ShapeLayerSchema, "shape.distortion", "Distortion", "Geometry"),
    color("shape.color", "Base colour", "Material"),
    color("shape.emissive", "Emissive colour", "Material"),
    slider(ShapeLayerSchema, "shape.metalness", "Metalness", "Material"),
    slider(ShapeLayerSchema, "shape.roughness", "Roughness", "Material"),
    toggle("shape.wireframe", "Wireframe", "Material"),
    toggle("shape.flatShading", "Flat shading", "Material"),
  ],
  tunnel: [
    slider(TunnelLayerSchema, "tunnel.radius", "Radius", "Geometry", { step: 0.1 }),
    slider(TunnelLayerSchema, "tunnel.length", "Length", "Geometry", { step: 1, rebuilds: true }),
    slider(TunnelLayerSchema, "tunnel.sides", "Sides", "Geometry", { rebuilds: true }),
    slider(TunnelLayerSchema, "tunnel.stripes", "Stripes", "Geometry"),
    slider(TunnelLayerSchema, "tunnel.twist", "Twist", "Geometry"),
    toggle("tunnel.wireframe", "Wireframe", "Material"),
    color("tunnel.colorA", "Colour A"),
    color("tunnel.colorB", "Colour B"),
  ],
  grid: [
    slider(GridLayerSchema, "grid.size", "Size", "Geometry", { step: 1, rebuilds: true }),
    slider(GridLayerSchema, "grid.divisions", "Divisions", "Geometry", { rebuilds: true }),
    slider(GridLayerSchema, "grid.wave", "Terrain wave", "Motion"),
    color("grid.color", "Colour"),
  ],
  spectrum: [
    slider(SpectrumLayerSchema, "spectrum.bars", "Bars", "Geometry", { rebuilds: true }),
    select(SpectrumLayerSchema, "spectrum.layout", "Layout", "Geometry"),
    slider(SpectrumLayerSchema, "spectrum.radius", "Radius", "Geometry", { step: 0.05 }),
    slider(SpectrumLayerSchema, "spectrum.barWidth", "Bar width", "Geometry", { step: 0.005 }),
    slider(SpectrumLayerSchema, "spectrum.maxHeight", "Max height", "Geometry", { step: 0.05 }),
    toggle("spectrum.mirror", "Mirror", "Geometry"),
    color("spectrum.colorA", "Colour A"),
    color("spectrum.colorB", "Colour B"),
  ],
};

export function fieldsForLayerType(type: LayerType): FieldSpec[] {
  return [...LAYER_TYPE_FIELDS[type], ...COMMON_LAYER_FIELDS];
}

/* ------------------------------------------------------------------ */
/* Scene-level field specs (environment, post-processing, audio)       */
/* ------------------------------------------------------------------ */

export type SceneFieldGroup = "Background" | "Fog" | "Lighting" | "Camera" | "Bloom" | "Effects" | "Audio";

export interface SceneFieldSpec extends Omit<FieldSpec, "group"> {
  group: SceneFieldGroup;
  /** Which scene section the path is relative to. */
  section: "environment" | "post" | "audio";
}

const E = EnvironmentSchema;
const env = (spec: FieldSpec, group: SceneFieldGroup): SceneFieldSpec => ({ ...spec, group, section: "environment" });
const post = (spec: FieldSpec, group: SceneFieldGroup): SceneFieldSpec => ({ ...spec, group, section: "post" });
const aud = (spec: FieldSpec): SceneFieldSpec => ({ ...spec, group: "Audio", section: "audio" });

export const SCENE_FIELDS: readonly SceneFieldSpec[] = [
  env(select(E, "background.mode", "Mode", "Layer"), "Background"),
  env(color("background.colorA", "Colour A"), "Background"),
  env(color("background.colorB", "Colour B"), "Background"),
  env(slider(E, "background.intensity", "Intensity", "Layer"), "Background"),
  env(toggle("fog.enabled", "Fog", "Layer"), "Fog"),
  env(color("fog.color", "Fog colour"), "Fog"),
  env(slider(E, "fog.density", "Density", "Layer", { step: 0.001 }), "Fog"),
  env(slider(E, "lighting.ambient", "Ambient", "Layer"), "Lighting"),
  env(slider(E, "lighting.key", "Key light", "Layer"), "Lighting"),
  env(color("lighting.keyColor", "Key colour"), "Lighting"),
  env(color("lighting.rimColor", "Rim colour"), "Lighting"),
  env(slider(E, "camera.fov", "Field of view", "Layer", { step: 1, unit: "°" }), "Camera"),
  env(slider(E, "camera.distance", "Distance", "Layer", { step: 0.1 }), "Camera"),
  env(slider(E, "camera.height", "Height", "Layer", { step: 0.1 }), "Camera"),
  env(toggle("camera.autoRotate", "Auto-rotate", "Layer"), "Camera"),
  env(slider(E, "camera.autoRotateSpeed", "Rotate speed", "Layer", { step: 0.05 }), "Camera"),
  env(slider(E, "camera.shake", "Beat shake", "Layer", { hint: "Camera shake on audio onsets" }), "Camera"),
  post(toggle("bloom.enabled", "Bloom", "Layer"), "Bloom"),
  post(slider(PostSchema, "bloom.intensity", "Intensity", "Layer"), "Bloom"),
  post(slider(PostSchema, "bloom.threshold", "Threshold", "Layer"), "Bloom"),
  post(slider(PostSchema, "bloom.radius", "Radius", "Layer"), "Bloom"),
  post(slider(PostSchema, "bloom.audioBoost", "Audio boost", "Layer", { hint: "Bloom pumps with overall energy" }), "Bloom"),
  post(slider(PostSchema, "chromaticAberration", "Chromatic aberration", "Layer"), "Effects"),
  post(slider(PostSchema, "vignette", "Vignette", "Layer"), "Effects"),
  post(slider(PostSchema, "noise", "Film grain", "Layer"), "Effects"),
  aud(slider(SceneAudioSettingsSchema, "sensitivity", "Sensitivity", "Layer", { hint: "Global gain for every audio mapping" })),
  aud(slider(SceneAudioSettingsSchema, "smoothing", "Smoothing", "Layer", { hint: "Release smoothing of audio features" })),
];

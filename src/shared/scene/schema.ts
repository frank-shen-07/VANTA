/**
 * CANONICAL SCENE CONTRACT — owned by the lead orchestrator.
 *
 * Every module (renderer, inspector, AI generation, persistence, node graph)
 * reads and writes scenes through these schemas. Do not redefine SceneConfig
 * elsewhere. Numeric bounds here are the single source of truth for clamping,
 * inspector slider ranges and the JSON Schema handed to the LLM.
 */
import { z } from "zod";

export const SCENE_SCHEMA_VERSION = 1 as const;

export const LIMITS = {
  maxLayers: 12,
  maxMappingsPerLayer: 6,
  maxGraphNodes: 48,
  maxGraphEdges: 96,
  maxNameLength: 48,
  maxPromptLength: 800,
} as const;

/* ------------------------------------------------------------------ */
/* Primitives                                                          */
/* ------------------------------------------------------------------ */

const num = (min: number, max: number) => z.number().min(min).max(max);
const int = (min: number, max: number) => z.number().int().min(min).max(max);
const vec3 = (min: number, max: number) =>
  z.tuple([num(min, max), num(min, max), num(min, max)]);

export const IdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,40}$/, "IDs are 1-40 chars of A-Z, a-z, 0-9, _ or -");

export const HexColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Colours are #rrggbb hex strings");

export const NameSchema = z.string().trim().min(1).max(LIMITS.maxNameLength);

/* ------------------------------------------------------------------ */
/* Audio reactivity                                                    */
/* ------------------------------------------------------------------ */

/** Keys of AudioFeatures — every value is normalised to 0..1. */
export const AUDIO_BANDS = ["bass", "mids", "highs", "energy", "onset"] as const;
export const AudioBandSchema = z.enum(AUDIO_BANDS);
export type AudioBand = z.infer<typeof AudioBandSchema>;

/**
 * Visual parameters that audio can drive. The modulation value `m` for a
 * target is the sum of (shaped feature x amount x global sensitivity) over all
 * mappings/graph outputs. Renderers apply it as:
 *  - scale:        uniform scale        x (1 + m)
 *  - opacity:      opacity              x (1 + m), clamped to 0..1
 *  - brightness:   glow / emissive      x (1 + m)
 *  - speed:        animation speed      x (1 + m)
 *  - rotation:     extra rotation offset of m radians (kick / wobble)
 *  - hue:          hue shift of m x 0.5 turns
 *  - displacement: layer-specific deformation amount + m (explode, distort, wave)
 *  - size:         particle size / line thickness x (1 + m)
 *  - bounce:       vertical offset of m world units
 * Not every layer type supports every target; see LAYER_TYPE_INFO.
 */
export const MAPPING_TARGETS = [
  "scale",
  "opacity",
  "brightness",
  "speed",
  "rotation",
  "hue",
  "displacement",
  "size",
  "bounce",
] as const;
export const MappingTargetSchema = z.enum(MAPPING_TARGETS);
export type MappingTarget = z.infer<typeof MappingTargetSchema>;

export const AudioMappingSchema = z.object({
  id: IdSchema,
  enabled: z.boolean(),
  source: AudioBandSchema,
  target: MappingTargetSchema,
  /** Strength. Negative values invert the response. */
  amount: num(-3, 3),
  /** Feature values below the threshold are ignored; above it are re-normalised. */
  threshold: num(0, 0.95),
  /** Extra per-mapping smoothing (0 = instant, 0.99 = very slow). */
  smoothing: num(0, 0.99),
});
export type AudioMapping = z.infer<typeof AudioMappingSchema>;

/* ------------------------------------------------------------------ */
/* Layers                                                              */
/* ------------------------------------------------------------------ */

export const LAYER_TYPES = ["particles", "rings", "shape", "tunnel", "grid", "spectrum"] as const;
export const LayerTypeSchema = z.enum(LAYER_TYPES);
export type LayerType = z.infer<typeof LayerTypeSchema>;

export const BlendingSchema = z.enum(["normal", "additive"]);

export const TransformSchema = z.object({
  position: vec3(-40, 40),
  /** Degrees. */
  rotation: vec3(-360, 360),
  scale: num(0.05, 10),
});
export type Transform = z.infer<typeof TransformSchema>;

export const MotionSchema = z.object({
  /** Continuous spin in radians/second around x, y, z. */
  spin: vec3(-3, 3),
  /** Layer animation speed multiplier (particle drift, ring waves, tunnel flow…). */
  speed: num(0, 5),
});
export type Motion = z.infer<typeof MotionSchema>;

const layerBase = {
  id: IdSchema,
  name: NameSchema,
  visible: z.boolean(),
  opacity: num(0, 1),
  /** Emissive / glow intensity. Values > 1 bloom strongly. */
  glow: num(0, 5),
  blending: BlendingSchema,
  transform: TransformSchema,
  motion: MotionSchema,
  reactivity: z.array(AudioMappingSchema).max(LIMITS.maxMappingsPerLayer),
};

export const PARTICLE_DISTRIBUTIONS = ["sphere", "shell", "cube", "disc", "spiral", "tunnel"] as const;
export const ParticlesLayerSchema = z.object({
  ...layerBase,
  type: z.literal("particles"),
  particles: z.object({
    count: int(100, 40000),
    size: num(0.005, 0.5),
    distribution: z.enum(PARTICLE_DISTRIBUTIONS),
    /** Radius / half-extent of the distribution in world units. */
    spread: num(0.5, 40),
    colorA: HexColorSchema,
    colorB: HexColorSchema,
    turbulence: num(0, 3),
    twinkle: num(0, 1),
  }),
});

export const RING_ARRANGEMENTS = ["tunnel", "concentric", "orbit"] as const;
export const RingsLayerSchema = z.object({
  ...layerBase,
  type: z.literal("rings"),
  rings: z.object({
    count: int(1, 48),
    radius: num(0.2, 20),
    /** Distance between rings (depth for tunnel, radius step for concentric). */
    spacing: num(0, 6),
    thickness: num(0.005, 0.6),
    /** 3 = triangle, 4 = square, 6 = hexagon, 64 = circle. */
    sides: int(3, 64),
    arrangement: z.enum(RING_ARRANGEMENTS),
    colorA: HexColorSchema,
    colorB: HexColorSchema,
    wave: num(0, 2),
  }),
});

export const SHAPE_GEOMETRIES = [
  "icosahedron",
  "octahedron",
  "dodecahedron",
  "tetrahedron",
  "torus",
  "torusKnot",
  "sphere",
  "box",
] as const;
export const ShapeLayerSchema = z.object({
  ...layerBase,
  type: z.literal("shape"),
  shape: z.object({
    geometry: z.enum(SHAPE_GEOMETRIES),
    detail: int(0, 4),
    instances: int(1, 32),
    /** Radius of the ring the instances orbit on (0 = all at the origin). */
    orbitRadius: num(0, 20),
    color: HexColorSchema,
    emissive: HexColorSchema,
    metalness: num(0, 1),
    roughness: num(0, 1),
    wireframe: z.boolean(),
    flatShading: z.boolean(),
    /** Organic vertex distortion amount. */
    distortion: num(0, 1),
  }),
});

export const TunnelLayerSchema = z.object({
  ...layerBase,
  type: z.literal("tunnel"),
  tunnel: z.object({
    radius: num(0.5, 20),
    length: num(10, 200),
    sides: int(3, 48),
    colorA: HexColorSchema,
    colorB: HexColorSchema,
    wireframe: z.boolean(),
    /** Twist along the length, in turns. */
    twist: num(-2, 2),
    /** Density of stripes / grid lines along the walls. */
    stripes: int(1, 64),
  }),
});

export const GridLayerSchema = z.object({
  ...layerBase,
  type: z.literal("grid"),
  grid: z.object({
    size: num(10, 400),
    divisions: int(4, 200),
    color: HexColorSchema,
    /** Height of the rolling terrain wave. */
    wave: num(0, 5),
  }),
});

export const SpectrumLayerSchema = z.object({
  ...layerBase,
  type: z.literal("spectrum"),
  spectrum: z.object({
    bars: int(8, 128),
    layout: z.enum(["circle", "line"]),
    radius: num(0.5, 20),
    barWidth: num(0.01, 1),
    maxHeight: num(0.1, 20),
    colorA: HexColorSchema,
    colorB: HexColorSchema,
    mirror: z.boolean(),
  }),
});

export const LayerSchema = z.discriminatedUnion("type", [
  ParticlesLayerSchema,
  RingsLayerSchema,
  ShapeLayerSchema,
  TunnelLayerSchema,
  GridLayerSchema,
  SpectrumLayerSchema,
]);

export type Layer = z.infer<typeof LayerSchema>;
export type ParticlesLayer = z.infer<typeof ParticlesLayerSchema>;
export type RingsLayer = z.infer<typeof RingsLayerSchema>;
export type ShapeLayer = z.infer<typeof ShapeLayerSchema>;
export type TunnelLayer = z.infer<typeof TunnelLayerSchema>;
export type GridLayer = z.infer<typeof GridLayerSchema>;
export type SpectrumLayer = z.infer<typeof SpectrumLayerSchema>;
export type LayerOfType<T extends LayerType> = Extract<Layer, { type: T }>;

/* ------------------------------------------------------------------ */
/* Environment, post-processing, global audio settings                 */
/* ------------------------------------------------------------------ */

export const EnvironmentSchema = z.object({
  background: z.object({
    mode: z.enum(["solid", "gradient", "nebula"]),
    colorA: HexColorSchema,
    colorB: HexColorSchema,
    intensity: num(0, 2),
  }),
  fog: z.object({
    enabled: z.boolean(),
    color: HexColorSchema,
    density: num(0, 0.15),
  }),
  lighting: z.object({
    ambient: num(0, 3),
    key: num(0, 5),
    keyColor: HexColorSchema,
    rimColor: HexColorSchema,
  }),
  camera: z.object({
    fov: num(20, 110),
    distance: num(1, 120),
    height: num(-40, 40),
    autoRotate: z.boolean(),
    autoRotateSpeed: num(-5, 5),
    /** Camera shake driven by audio onsets. */
    shake: num(0, 1),
  }),
});
export type Environment = z.infer<typeof EnvironmentSchema>;

export const PostSchema = z.object({
  bloom: z.object({
    enabled: z.boolean(),
    intensity: num(0, 4),
    threshold: num(0, 1),
    radius: num(0, 1),
    /** Bloom intensity x (1 + energy x audioBoost). */
    audioBoost: num(0, 3),
  }),
  /** Normalised 0..1; renderer maps to a pixel offset. */
  chromaticAberration: num(0, 1),
  vignette: num(0, 1),
  noise: num(0, 1),
});
export type PostSettings = z.infer<typeof PostSchema>;

export const SceneAudioSettingsSchema = z.object({
  /** Global gain applied to every mapping and graph output. */
  sensitivity: num(0, 3),
  /** Release smoothing applied by the audio engine to AudioFeatures. */
  smoothing: num(0, 0.95),
});
export type SceneAudioSettings = z.infer<typeof SceneAudioSettingsSchema>;

/* ------------------------------------------------------------------ */
/* Node graph (audio → processing → visual parameter)                  */
/* ------------------------------------------------------------------ */

const nodeBase = {
  id: IdSchema,
  x: num(-5000, 5000),
  y: num(-5000, 5000),
};

export const GRAPH_NODE_KINDS = ["audioBand", "multiply", "clamp", "smooth", "remap", "visualParam"] as const;
export const GraphNodeKindSchema = z.enum(GRAPH_NODE_KINDS);
export type GraphNodeKind = z.infer<typeof GraphNodeKindSchema>;

export const GraphNodeSchema = z.discriminatedUnion("kind", [
  z.object({ ...nodeBase, kind: z.literal("audioBand"), band: AudioBandSchema }),
  /** Output = product of all inputs x factor. */
  z.object({ ...nodeBase, kind: z.literal("multiply"), factor: num(-10, 10) }),
  z.object({ ...nodeBase, kind: z.literal("clamp"), min: num(-10, 10), max: num(-10, 10) }),
  z.object({ ...nodeBase, kind: z.literal("smooth"), amount: num(0, 0.99) }),
  z.object({
    ...nodeBase,
    kind: z.literal("remap"),
    inMin: num(-10, 10),
    inMax: num(-10, 10),
    outMin: num(-10, 10),
    outMax: num(-10, 10),
  }),
  /** Sink: adds its input to a layer's modulation target. */
  z.object({ ...nodeBase, kind: z.literal("visualParam"), layerId: IdSchema, target: MappingTargetSchema }),
]);
export type GraphNode = z.infer<typeof GraphNodeSchema>;
export type GraphNodeOfKind<K extends GraphNodeKind> = Extract<GraphNode, { kind: K }>;

export const GraphEdgeSchema = z.object({
  id: IdSchema,
  source: IdSchema,
  target: IdSchema,
});
export type GraphEdge = z.infer<typeof GraphEdgeSchema>;

export const GraphSchema = z.object({
  enabled: z.boolean(),
  nodes: z.array(GraphNodeSchema).max(LIMITS.maxGraphNodes),
  edges: z.array(GraphEdgeSchema).max(LIMITS.maxGraphEdges),
});
export type NodeGraph = z.infer<typeof GraphSchema>;

/* ------------------------------------------------------------------ */
/* Scene                                                               */
/* ------------------------------------------------------------------ */

export const SCENE_ORIGINS = ["default", "preset", "ai", "heuristic", "import", "manual"] as const;

export const SceneMetaSchema = z.object({
  origin: z.enum(SCENE_ORIGINS),
  /** Prompt that produced the scene, if any. */
  prompt: z.string().max(LIMITS.maxPromptLength).optional(),
  createdAt: z.string().max(40),
  updatedAt: z.string().max(40),
});

export const SceneConfigSchema = z.object({
  version: z.literal(SCENE_SCHEMA_VERSION),
  id: IdSchema,
  name: NameSchema,
  /** Preset the scene was derived from ("custom" when none). */
  preset: z.string().max(40),
  environment: EnvironmentSchema,
  post: PostSchema,
  audio: SceneAudioSettingsSchema,
  layers: z.array(LayerSchema).max(LIMITS.maxLayers),
  graph: GraphSchema,
  meta: SceneMetaSchema,
});
export type SceneConfig = z.infer<typeof SceneConfigSchema>;

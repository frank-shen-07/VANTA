/**
 * Default values and factories for scene objects — owned by the lead orchestrator.
 * Factories always return schema-valid objects.
 */
import { createId, deepMerge, type DeepPartial } from "@/shared/utils/object";
import {
  SCENE_SCHEMA_VERSION,
  type AudioMapping,
  type Environment,
  type GraphNode,
  type GraphNodeKind,
  type Layer,
  type LayerOfType,
  type LayerType,
  type NodeGraph,
  type PostSettings,
  type SceneAudioSettings,
  type SceneConfig,
} from "./schema";

export const DEFAULT_ENVIRONMENT: Environment = {
  background: { mode: "gradient", colorA: "#05040a", colorB: "#140a26", intensity: 1 },
  fog: { enabled: true, color: "#07060d", density: 0.025 },
  lighting: { ambient: 0.35, key: 1.4, keyColor: "#b9a6ff", rimColor: "#36e0ff" },
  camera: { fov: 55, distance: 14, height: 1.5, autoRotate: true, autoRotateSpeed: 0.4, shake: 0.15 },
};

export const DEFAULT_POST: PostSettings = {
  bloom: { enabled: true, intensity: 1.2, threshold: 0.2, radius: 0.7, audioBoost: 0.8 },
  chromaticAberration: 0.15,
  vignette: 0.45,
  noise: 0.08,
};

export const DEFAULT_AUDIO_SETTINGS: SceneAudioSettings = { sensitivity: 1, smoothing: 0.55 };

export function createEmptyGraph(): NodeGraph {
  return { enabled: true, nodes: [], edges: [] };
}

export function createMapping(partial: Partial<AudioMapping> = {}): AudioMapping {
  return {
    id: createId("map"),
    enabled: true,
    source: "bass",
    target: "scale",
    amount: 0.6,
    threshold: 0,
    smoothing: 0.2,
    ...partial,
  };
}

const BASE = {
  visible: true,
  opacity: 1,
  glow: 1.2,
  blending: "additive" as const,
  transform: { position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], scale: 1 },
  motion: { spin: [0, 0.1, 0] as [number, number, number], speed: 1 },
};

/** Per-type default layer bodies (without id/name/reactivity). */
const LAYER_DEFAULTS: { [T in LayerType]: () => Omit<LayerOfType<T>, "id" | "name" | "reactivity"> } = {
  particles: () => ({
    ...BASE,
    type: "particles",
    particles: {
      count: 6000,
      size: 0.06,
      distribution: "sphere",
      spread: 12,
      colorA: "#8b5cf6",
      colorB: "#22d3ee",
      turbulence: 0.6,
      twinkle: 0.4,
    },
  }),
  rings: () => ({
    ...BASE,
    glow: 2,
    motion: { spin: [0, 0, 0.15], speed: 1 },
    type: "rings",
    rings: {
      count: 12,
      radius: 4,
      spacing: 2.5,
      thickness: 0.04,
      sides: 64,
      arrangement: "tunnel",
      colorA: "#a855f7",
      colorB: "#22d3ee",
      wave: 0.4,
    },
  }),
  shape: () => ({
    ...BASE,
    blending: "normal",
    glow: 0.6,
    motion: { spin: [0.15, 0.3, 0], speed: 1 },
    type: "shape",
    shape: {
      geometry: "icosahedron",
      detail: 1,
      instances: 1,
      orbitRadius: 0,
      color: "#1b1530",
      emissive: "#7c3aed",
      metalness: 0.6,
      roughness: 0.3,
      wireframe: false,
      flatShading: true,
      distortion: 0.25,
    },
  }),
  tunnel: () => ({
    ...BASE,
    glow: 1.5,
    motion: { spin: [0, 0, 0.05], speed: 1 },
    type: "tunnel",
    tunnel: {
      radius: 6,
      length: 120,
      sides: 12,
      colorA: "#ff2e88",
      colorB: "#22d3ee",
      wireframe: true,
      twist: 0.15,
      stripes: 24,
    },
  }),
  grid: () => ({
    ...BASE,
    glow: 1.4,
    transform: { position: [0, -3, 0], rotation: [0, 0, 0], scale: 1 },
    motion: { spin: [0, 0, 0], speed: 1 },
    type: "grid",
    grid: { size: 160, divisions: 64, color: "#ff3cac", wave: 1.2 },
  }),
  spectrum: () => ({
    ...BASE,
    glow: 1.6,
    motion: { spin: [0, 0, 0], speed: 1 },
    type: "spectrum",
    spectrum: {
      bars: 64,
      layout: "circle",
      radius: 5,
      barWidth: 0.12,
      maxHeight: 4,
      colorA: "#22d3ee",
      colorB: "#a855f7",
      mirror: true,
    },
  }),
};

export const DEFAULT_LAYER_NAMES: Record<LayerType, string> = {
  particles: "Particle Field",
  rings: "Neon Rings",
  shape: "Core Shape",
  tunnel: "Tunnel",
  grid: "Horizon Grid",
  spectrum: "Spectrum",
};

/** Sensible starting audio mappings for a freshly added layer. */
export function defaultMappingsFor(type: LayerType): AudioMapping[] {
  switch (type) {
    case "particles":
      return [
        createMapping({ source: "bass", target: "displacement", amount: 0.8 }),
        createMapping({ source: "highs", target: "brightness", amount: 0.6 }),
      ];
    case "rings":
      return [
        createMapping({ source: "bass", target: "scale", amount: 0.35 }),
        createMapping({ source: "energy", target: "brightness", amount: 1 }),
      ];
    case "shape":
      return [
        createMapping({ source: "bass", target: "scale", amount: 0.4 }),
        createMapping({ source: "mids", target: "displacement", amount: 0.6 }),
      ];
    case "tunnel":
      return [
        createMapping({ source: "energy", target: "speed", amount: 1.2 }),
        createMapping({ source: "bass", target: "brightness", amount: 0.8 }),
      ];
    case "grid":
      return [createMapping({ source: "bass", target: "displacement", amount: 1 })];
    case "spectrum":
      return [createMapping({ source: "onset", target: "brightness", amount: 0.8, smoothing: 0.5 })];
  }
}

/**
 * Creates a complete, schema-valid layer of the given type.
 * `overrides` is deep-merged (arrays such as `reactivity` are replaced).
 */
export function createLayer<T extends LayerType>(type: T, overrides?: DeepPartial<LayerOfType<T>>): LayerOfType<T> {
  const base = {
    id: createId("lyr"),
    name: DEFAULT_LAYER_NAMES[type],
    reactivity: defaultMappingsFor(type),
    ...LAYER_DEFAULTS[type](),
  } as unknown as LayerOfType<T>;
  const merged = deepMerge(base, overrides ?? {});
  return { ...merged, type } as LayerOfType<T>;
}

/** The default body for a layer type, used by the sanitizer to fill missing/invalid fields. */
export function defaultLayerBody(type: LayerType): Layer {
  return createLayer(type);
}

export const GRAPH_NODE_DEFAULTS: { [K in GraphNodeKind]: () => Omit<Extract<GraphNode, { kind: K }>, "id" | "x" | "y"> } = {
  audioBand: () => ({ kind: "audioBand", band: "bass" }),
  multiply: () => ({ kind: "multiply", factor: 1 }),
  clamp: () => ({ kind: "clamp", min: 0, max: 1 }),
  smooth: () => ({ kind: "smooth", amount: 0.6 }),
  remap: () => ({ kind: "remap", inMin: 0, inMax: 1, outMin: 0, outMax: 1 }),
  visualParam: () => ({ kind: "visualParam", layerId: "lyr_unset", target: "scale" }),
};

export function createGraphNode<K extends GraphNodeKind>(
  kind: K,
  overrides: Partial<Extract<GraphNode, { kind: K }>> = {},
): Extract<GraphNode, { kind: K }> {
  return {
    id: createId("node"),
    x: 0,
    y: 0,
    ...GRAPH_NODE_DEFAULTS[kind](),
    ...overrides,
    kind,
  } as Extract<GraphNode, { kind: K }>;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export interface CreateSceneOptions {
  name?: string;
  preset?: string;
  origin?: SceneConfig["meta"]["origin"];
  prompt?: string;
  layers?: Layer[];
  environment?: DeepPartial<Environment>;
  post?: DeepPartial<PostSettings>;
  audio?: Partial<SceneAudioSettings>;
}

export function createScene(options: CreateSceneOptions = {}): SceneConfig {
  const now = nowIso();
  return {
    version: SCENE_SCHEMA_VERSION,
    id: createId("scn"),
    name: options.name ?? "Untitled Scene",
    preset: options.preset ?? "custom",
    environment: deepMerge(DEFAULT_ENVIRONMENT, options.environment ?? {}),
    post: deepMerge(DEFAULT_POST, options.post ?? {}),
    audio: { ...DEFAULT_AUDIO_SETTINGS, ...options.audio },
    layers: options.layers ?? [],
    graph: createEmptyGraph(),
    meta: {
      origin: options.origin ?? "default",
      ...(options.prompt ? { prompt: options.prompt } : {}),
      createdAt: now,
      updatedAt: now,
    },
  };
}

/** Minimal, always-valid scene used when imported or generated data is unusable. */
export function createFallbackScene(): SceneConfig {
  return createScene({
    name: "Fallback Scene",
    origin: "default",
    layers: [createLayer("particles"), createLayer("rings", { rings: { arrangement: "concentric", count: 6 } })],
  });
}

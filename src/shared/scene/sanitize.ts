/**
 * Validation + repair of untrusted scene data (AI output, imported files,
 * share links, localStorage) — owned by the lead orchestrator.
 *
 * Strategy: walk the canonical Zod schema alongside the input and a known-good
 * fallback value. Numbers are clamped to schema bounds, invalid leaves fall
 * back to defaults, unsupported layer types / mapping targets / graph nodes are
 * dropped, IDs are de-duplicated. The result is then strictly re-validated.
 */
import { z } from "zod";
import { normalizeHexColor } from "@/shared/utils/color";
import { createId, isPlainObject } from "@/shared/utils/object";
import { createFallbackScene, createGraphNode, createLayer, createMapping, createScene } from "./defaults";
import { LAYER_SCHEMAS, layerSupportsTarget } from "./layers";
import {
  AudioMappingSchema,
  GRAPH_NODE_KINDS,
  GraphEdgeSchema,
  GraphNodeSchema,
  IdSchema,
  LAYER_TYPES,
  LIMITS,
  LayerSchema,
  SceneConfigSchema,
  type AudioMapping,
  type GraphEdge,
  type GraphNode,
  type GraphNodeKind,
  type Layer,
  type LayerType,
  type NodeGraph,
  type SceneConfig,
} from "./schema";

export interface SanitizeResult<T> {
  value: T;
  /** Human-readable notes about every repair that was made. */
  warnings: string[];
}

type Def = {
  type: string;
  shape?: Record<string, z.ZodType>;
  items?: z.ZodType[];
  innerType?: z.ZodType;
};
const defOf = (s: z.ZodType) => (s as unknown as { _zod: { def: Def } })._zod.def;

/** Generic schema-guided repair for objects, tuples and leaves (arrays of records are handled by callers). */
function repair(schema: z.ZodType, input: unknown, fallback: unknown, path: string, warnings: string[]): unknown {
  const def = defOf(schema);
  switch (def.type) {
    case "object": {
      if (input !== undefined && !isPlainObject(input)) warnings.push(`${path}: expected an object, using defaults`);
      const src = isPlainObject(input) ? input : {};
      const fb = isPlainObject(fallback) ? fallback : {};
      const out: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(def.shape ?? {})) {
        const v = repair(child, src[key], fb[key], path ? `${path}.${key}` : key, warnings);
        if (v !== undefined) out[key] = v;
      }
      return out;
    }
    case "tuple": {
      const items = def.items ?? [];
      const src = Array.isArray(input) ? input : [];
      if (input !== undefined && !Array.isArray(input)) warnings.push(`${path}: expected a list, using defaults`);
      const fb = Array.isArray(fallback) ? fallback : [];
      return items.map((item, i) => repair(item, src[i], fb[i], `${path}.${i}`, warnings));
    }
    case "optional": {
      if (input === undefined) return undefined;
      return repair(def.innerType as z.ZodType, input, fallback, path, warnings);
    }
    case "number": {
      let v = input;
      if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) v = Number(v);
      if (typeof v !== "number" || !Number.isFinite(v)) {
        if (input !== undefined) warnings.push(`${path}: invalid number, using default`);
        return fallback;
      }
      const n = schema as unknown as { minValue: number | null; maxValue: number | null; isInt: boolean };
      let c = n.isInt ? Math.round(v) : v;
      if (n.minValue != null && c < n.minValue) c = n.minValue;
      if (n.maxValue != null && c > n.maxValue) c = n.maxValue;
      if (c !== v) warnings.push(`${path}: ${v} adjusted to ${c}`);
      return c;
    }
    case "boolean": {
      if (typeof input === "boolean") return input;
      if (input === "true" || input === "false") return input === "true";
      if (input !== undefined) warnings.push(`${path}: invalid boolean, using default`);
      return fallback;
    }
    default: {
      if (schema.safeParse(input).success) return input;
      if (def.type === "string") {
        const color = normalizeHexColor(input);
        if (color && schema.safeParse(color).success) return color;
        if (typeof input === "string") {
          const trimmed = input.trim().slice(0, LIMITS.maxPromptLength);
          if (trimmed !== input && schema.safeParse(trimmed).success) return trimmed;
          const short = input.trim().slice(0, LIMITS.maxNameLength);
          if (short && schema.safeParse(short).success) return short;
        }
      }
      if (input !== undefined) warnings.push(`${path}: unsupported value ${JSON.stringify(input)?.slice(0, 40)}, using default`);
      return fallback;
    }
  }
}

function freshId(prefix: string, candidate: unknown, used: Set<string>): string {
  if (typeof candidate === "string" && IdSchema.safeParse(candidate).success && !used.has(candidate)) {
    used.add(candidate);
    return candidate;
  }
  const id = createId(prefix);
  used.add(id);
  return id;
}

function sanitizeMappings(type: LayerType, input: unknown, path: string, warnings: string[]): AudioMapping[] {
  if (input === undefined) return [];
  if (!Array.isArray(input)) {
    warnings.push(`${path}: expected a list of mappings`);
    return [];
  }
  const used = new Set<string>();
  const out: AudioMapping[] = [];
  input.forEach((raw, i) => {
    const p = `${path}.${i}`;
    if (!isPlainObject(raw)) return void warnings.push(`${p}: dropped (not an object)`);
    const fallback = createMapping();
    const m = repair(AudioMappingSchema, raw, fallback, p, warnings) as AudioMapping;
    if (raw.target !== undefined && m.target !== raw.target) return void warnings.push(`${p}: dropped (unknown target ${JSON.stringify(raw.target)})`);
    if (raw.source !== undefined && m.source !== raw.source) return void warnings.push(`${p}: dropped (unknown source ${JSON.stringify(raw.source)})`);
    if (!layerSupportsTarget(type, m.target)) return void warnings.push(`${p}: dropped (${type} layers do not support "${m.target}")`);
    m.id = freshId("map", raw.id, used);
    out.push(m);
  });
  if (out.length > LIMITS.maxMappingsPerLayer) {
    warnings.push(`${path}: trimmed to ${LIMITS.maxMappingsPerLayer} mappings`);
    out.length = LIMITS.maxMappingsPerLayer;
  }
  return out;
}

/** Repairs one layer. Returns null (with a warning) when the type is unsupported. */
export function sanitizeLayer(input: unknown, path = "layer", warnings: string[] = [], usedIds: Set<string> = new Set()): Layer | null {
  if (!isPlainObject(input)) {
    warnings.push(`${path}: dropped (not an object)`);
    return null;
  }
  const type = input.type;
  if (typeof type !== "string" || !(LAYER_TYPES as readonly string[]).includes(type)) {
    warnings.push(`${path}: dropped unsupported layer type ${JSON.stringify(type)}`);
    return null;
  }
  const layerType = type as LayerType;
  const fallback = createLayer(layerType);
  const repaired = repair(LAYER_SCHEMAS[layerType], { ...input, reactivity: undefined }, fallback, path, warnings) as Layer;
  repaired.id = freshId("lyr", input.id, usedIds);
  repaired.reactivity = input.reactivity === undefined ? fallback.reactivity : sanitizeMappings(layerType, input.reactivity, `${path}.reactivity`, warnings);
  const checked = LayerSchema.safeParse(repaired);
  if (!checked.success) {
    warnings.push(`${path}: dropped (could not be repaired: ${checked.error.issues[0]?.message})`);
    return null;
  }
  return checked.data;
}

function sanitizeGraph(input: unknown, layerIds: Set<string>, warnings: string[]): NodeGraph {
  const graph: NodeGraph = { enabled: true, nodes: [], edges: [] };
  if (input === undefined) return graph;
  if (!isPlainObject(input)) {
    warnings.push("graph: expected an object, using an empty graph");
    return graph;
  }
  if (typeof input.enabled === "boolean") graph.enabled = input.enabled;
  const usedNodeIds = new Set<string>();
  const rawNodes = Array.isArray(input.nodes) ? input.nodes : [];
  rawNodes.slice(0, LIMITS.maxGraphNodes).forEach((raw, i) => {
    const p = `graph.nodes.${i}`;
    if (!isPlainObject(raw) || !(GRAPH_NODE_KINDS as readonly string[]).includes(raw.kind as string)) {
      return void warnings.push(`${p}: dropped unsupported node`);
    }
    const kind = raw.kind as GraphNodeKind;
    const fallback = createGraphNode(kind);
    const option = (GraphNodeSchema as unknown as { options: z.ZodType[] }).options.find(
      (o) => (defOf(o).shape?.kind as unknown as { _zod: { def: { values: string[] } } })._zod.def.values[0] === kind,
    );
    if (!option) return void warnings.push(`${p}: dropped unsupported node`);
    const node = repair(option, raw, fallback, p, warnings) as GraphNode;
    node.id = freshId("node", raw.id, usedNodeIds);
    if (node.kind === "visualParam" && !layerIds.has(node.layerId)) warnings.push(`${p}: targets a missing layer (${node.layerId})`);
    if (GraphNodeSchema.safeParse(node).success) graph.nodes.push(node);
  });
  if (rawNodes.length > LIMITS.maxGraphNodes) warnings.push(`graph.nodes: trimmed to ${LIMITS.maxGraphNodes}`);
  const nodeIds = new Set(graph.nodes.map((n) => n.id));
  const usedEdgeIds = new Set<string>();
  const seenPairs = new Set<string>();
  const rawEdges = Array.isArray(input.edges) ? input.edges : [];
  rawEdges.slice(0, LIMITS.maxGraphEdges).forEach((raw, i) => {
    if (!isPlainObject(raw)) return;
    const edge = { id: freshId("edge", raw.id, usedEdgeIds), source: raw.source, target: raw.target } as GraphEdge;
    const pair = `${edge.source}->${edge.target}`;
    if (!GraphEdgeSchema.safeParse(edge).success || !nodeIds.has(edge.source) || !nodeIds.has(edge.target) || edge.source === edge.target || seenPairs.has(pair)) {
      return void warnings.push(`graph.edges.${i}: dropped invalid connection`);
    }
    seenPairs.add(pair);
    graph.edges.push(edge);
  });
  return graph;
}

/**
 * Validates and repairs an untrusted scene. Never throws.
 * `ok: false` means the input was unusable and `value` is a safe fallback scene.
 */
export function sanitizeSceneConfig(input: unknown): SanitizeResult<SceneConfig> & { ok: boolean } {
  const warnings: string[] = [];
  if (!isPlainObject(input)) {
    return { ok: false, value: createFallbackScene(), warnings: ["Scene is not a JSON object; loaded a fallback scene."] };
  }
  if (input.version !== undefined && input.version !== 1) warnings.push(`version: ${JSON.stringify(input.version)} is not supported, treated as version 1`);

  const fallback = createScene({ name: "Untitled Scene" });
  const { layers: rawLayers, graph: rawGraph, ...rest } = input;
  const shell = repair(
    SceneConfigSchema.omit({ layers: true, graph: true }),
    { ...rest, version: 1 },
    fallback,
    "",
    warnings,
  ) as Omit<SceneConfig, "layers" | "graph">;

  const layers: Layer[] = [];
  const usedIds = new Set<string>();
  if (rawLayers !== undefined && !Array.isArray(rawLayers)) warnings.push("layers: expected a list");
  const layerList = Array.isArray(rawLayers) ? rawLayers : [];
  for (let i = 0; i < layerList.length; i++) {
    if (layers.length >= LIMITS.maxLayers) {
      warnings.push(`layers: trimmed to ${LIMITS.maxLayers} layers`);
      break;
    }
    const layer = sanitizeLayer(layerList[i], `layers.${i}`, warnings, usedIds);
    if (layer) layers.push(layer);
  }

  const graph = sanitizeGraph(rawGraph, new Set(layers.map((l) => l.id)), warnings);
  const scene = { ...shell, layers, graph } as SceneConfig;
  const checked = SceneConfigSchema.safeParse(scene);
  if (!checked.success) {
    warnings.push(`Scene could not be repaired (${checked.error.issues[0]?.message}); loaded a fallback scene.`);
    return { ok: false, value: createFallbackScene(), warnings };
  }
  return { ok: true, value: checked.data, warnings };
}

/** Strict check without repair — true when `input` is already a valid SceneConfig. */
export function isValidSceneConfig(input: unknown): input is SceneConfig {
  return SceneConfigSchema.safeParse(input).success;
}

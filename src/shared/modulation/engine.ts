/**
 * Visual mapping engine — owned by the lead orchestrator.
 *
 * Turns AudioFeatures into per-layer modulation values once per frame by
 * evaluating (1) each layer's `reactivity` mappings and (2) the node graph.
 * Pure TypeScript, allocation-free in the steady state: call it from the
 * renderer's animation loop with a persistent ModulationState.
 */
import type { AudioFeatures } from "@/shared/audio/contract";
import { MAPPING_TARGETS, type AudioMapping, type GraphNode, type MappingTarget, type NodeGraph, type SceneConfig } from "@/shared/scene/schema";

export type LayerModulation = Record<MappingTarget, number>;

export interface GlobalModulation {
  /** 0..1 camera shake amount (onset x environment.camera.shake). */
  cameraShake: number;
  /** Multiplier for bloom intensity (1 + energy x audioBoost). */
  bloomMultiplier: number;
}

export interface ModulationState {
  /** Per-layer modulation values for the current frame. Objects are reused between frames. */
  layers: Map<string, LayerModulation>;
  global: GlobalModulation;
  /** Smoothed values per mapping id / smooth-node id. */
  smoothing: Map<string, number>;
  /** Cached topological order of the graph (recomputed when the graph object changes). */
  graphCache: { graph: NodeGraph | null; order: GraphNode[]; inputs: Map<string, string[]> };
  nodeValues: Map<string, number>;
  /** Scratch set reused every frame to drop modulation of deleted layers. */
  seen: Set<string>;
}

export function createModulationState(): ModulationState {
  return {
    layers: new Map(),
    global: { cameraShake: 0, bloomMultiplier: 1 },
    smoothing: new Map(),
    graphCache: { graph: null, order: [], inputs: new Map() },
    nodeValues: new Map(),
    seen: new Set(),
  };
}

export function createZeroModulation(): LayerModulation {
  const m = {} as LayerModulation;
  for (const t of MAPPING_TARGETS) m[t] = 0;
  return m;
}

/** Shared zero object for layers without modulation. Never mutate. */
export const ZERO_MODULATION: Readonly<LayerModulation> = Object.freeze(createZeroModulation());

function resetModulation(m: LayerModulation) {
  for (const t of MAPPING_TARGETS) m[t] = 0;
}

/** Frame-rate independent exponential smoothing: smoothing 0 = instant, 0.99 = very slow (per 60 fps frame). */
export function smoothValue(prev: number, next: number, smoothing: number, dt: number): number {
  if (smoothing <= 0) return next;
  const k = Math.pow(smoothing, Math.max(0, dt) * 60);
  return next + (prev - next) * k;
}

/** Applies threshold gating: values below `threshold` → 0, above re-normalised to 0..1. */
export function gate(value: number, threshold: number): number {
  if (threshold <= 0) return value;
  if (value <= threshold) return 0;
  return (value - threshold) / (1 - threshold);
}

export function evaluateMapping(mapping: AudioMapping, features: Readonly<AudioFeatures>): number {
  return gate(features[mapping.source], mapping.threshold) * mapping.amount;
}

function graphOrder(state: ModulationState, graph: NodeGraph) {
  const cache = state.graphCache;
  if (cache.graph === graph) return cache;
  const inputs = new Map<string, string[]>();
  for (const node of graph.nodes) inputs.set(node.id, []);
  for (const edge of graph.edges) inputs.get(edge.target)?.push(edge.source);
  // Kahn's algorithm; nodes in cycles are excluded (they output 0).
  const indegree = new Map<string, number>();
  for (const node of graph.nodes) indegree.set(node.id, inputs.get(node.id)?.filter((s) => inputs.has(s)).length ?? 0);
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const queue = graph.nodes.filter((n) => indegree.get(n.id) === 0);
  const order: GraphNode[] = [];
  while (queue.length) {
    const node = queue.shift()!;
    order.push(node);
    for (const edge of graph.edges) {
      if (edge.source !== node.id) continue;
      const d = (indegree.get(edge.target) ?? 0) - 1;
      indegree.set(edge.target, d);
      if (d === 0 && byId.has(edge.target)) queue.push(byId.get(edge.target)!);
    }
  }
  cache.graph = graph;
  cache.order = order;
  cache.inputs = inputs;
  return cache;
}

/** Evaluates the node graph, adding visualParam outputs into `state.layers`. */
export function evaluateGraph(graph: NodeGraph, features: Readonly<AudioFeatures>, sensitivity: number, dt: number, state: ModulationState): void {
  if (!graph.enabled || graph.nodes.length === 0) return;
  const { order, inputs } = graphOrder(state, graph);
  const values = state.nodeValues;
  values.clear();
  for (const node of order) {
    const ins = inputs.get(node.id) ?? [];
    let sum = 0;
    for (const id of ins) sum += values.get(id) ?? 0;
    let out = 0;
    switch (node.kind) {
      case "audioBand":
        out = features[node.band];
        break;
      case "multiply": {
        if (ins.length === 0) out = 0;
        else {
          out = node.factor;
          for (const id of ins) out *= values.get(id) ?? 0;
        }
        break;
      }
      case "clamp": {
        const lo = Math.min(node.min, node.max);
        const hi = Math.max(node.min, node.max);
        out = sum < lo ? lo : sum > hi ? hi : sum;
        break;
      }
      case "smooth": {
        const prev = state.smoothing.get(node.id) ?? sum;
        out = smoothValue(prev, sum, node.amount, dt);
        state.smoothing.set(node.id, out);
        break;
      }
      case "remap": {
        const span = node.inMax - node.inMin;
        const t = span === 0 ? 0 : (sum - node.inMin) / span;
        out = node.outMin + t * (node.outMax - node.outMin);
        break;
      }
      case "visualParam": {
        out = sum;
        const target = state.layers.get(node.layerId);
        if (target) target[node.target] += sum * sensitivity;
        break;
      }
    }
    values.set(node.id, Number.isFinite(out) ? out : 0);
  }
}

/**
 * Computes modulation for every layer in `scene`. Call once per frame.
 * @param dt seconds since the previous frame
 */
export function computeModulation(scene: SceneConfig, features: Readonly<AudioFeatures>, dt: number, state: ModulationState): ModulationState {
  const sensitivity = scene.audio.sensitivity;
  const seen = state.seen;
  seen.clear();
  for (const layer of scene.layers) {
    seen.add(layer.id);
    let mod = state.layers.get(layer.id);
    if (!mod) {
      mod = createZeroModulation();
      state.layers.set(layer.id, mod);
    } else resetModulation(mod);
    for (const mapping of layer.reactivity) {
      if (!mapping.enabled) continue;
      const raw = evaluateMapping(mapping, features);
      const prev = state.smoothing.get(mapping.id) ?? raw;
      const v = smoothValue(prev, raw, mapping.smoothing, dt);
      state.smoothing.set(mapping.id, v);
      mod[mapping.target] += v * sensitivity;
    }
  }
  for (const id of state.layers.keys()) if (!seen.has(id)) state.layers.delete(id);
  evaluateGraph(scene.graph, features, sensitivity, dt, state);
  state.global.cameraShake = features.onset * scene.environment.camera.shake * Math.min(1, sensitivity);
  state.global.bloomMultiplier = 1 + features.energy * scene.post.bloom.audioBoost * sensitivity;
  return state;
}

/** Modulation for one layer (ZERO_MODULATION when absent). */
export function getLayerModulation(state: ModulationState, layerId: string): Readonly<LayerModulation> {
  return state.layers.get(layerId) ?? ZERO_MODULATION;
}

/** Shared singleton state for the live renderer. */
export const liveModulation: ModulationState = createModulationState();

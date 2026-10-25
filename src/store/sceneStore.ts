/**
 * THE shared scene state — owned by the lead orchestrator.
 *
 * Every pipeline (inspector edits, AI generation/refinement, presets, file
 * load, node graph) writes through these actions; the renderer reads from
 * here. Do not create another scene store.
 *
 * Layer array order = draw order (index 0 is drawn first / furthest back).
 */
import { create } from "zustand";
import { applyScenePatch, type ApplyPatchResult, type ScenePatch } from "@/shared/scene/patch";
import { createGraphNode, createLayer, createMapping } from "@/shared/scene/defaults";
import { createPresetScene, DEFAULT_PRESET_ID } from "@/shared/scene/presets";
import { sanitizeLayer, sanitizeSceneConfig } from "@/shared/scene/sanitize";
import {
  LIMITS,
  SceneConfigSchema,
  type AudioMapping,
  type Environment,
  type GraphEdge,
  type GraphNode,
  type GraphNodeKind,
  type Layer,
  type LayerOfType,
  type LayerType,
  type NodeGraph,
  type PostSettings,
  type SceneAudioSettings,
  type SceneConfig,
} from "@/shared/scene/schema";
import { createId, deepMerge, setAtPath, type DeepPartial } from "@/shared/utils/object";

export type ChangeSource = "user" | "ai" | "preset" | "import" | "history" | "graph" | "init";

export interface CommitOptions {
  source?: ChangeSource;
  /** Consecutive commits with the same key within 1s merge into one undo step (slider drags). */
  coalesceKey?: string;
}

export interface SetSceneOptions {
  source: ChangeSource;
  /** Layer to select after loading (defaults to the first layer). */
  selectLayerId?: string | null;
  /** Clear undo history (e.g. when opening a different project). */
  resetHistory?: boolean;
}

type SceneSection = "environment" | "post" | "audio";

export interface SceneStoreState {
  scene: SceneConfig;
  selectedLayerId: string | null;
  past: SceneConfig[];
  future: SceneConfig[];
  /** Increments on every scene change (autosave, dirty tracking). */
  revision: number;
  lastChange: { source: ChangeSource; at: number; coalesceKey?: string };

  /* scene */
  setScene(scene: unknown, options: SetSceneOptions): { ok: boolean; warnings: string[] };
  loadPreset(presetId: string): void;
  applyPatch(patch: ScenePatch, source?: ChangeSource): ApplyPatchResult;
  renameScene(name: string): void;
  updateSection<S extends SceneSection>(section: S, changes: DeepPartial<SceneConfig[S]>, options?: CommitOptions): void;
  /** Inspector helper: set one field by dot path (e.g. "camera.fov"). */
  setSectionField(section: SceneSection, path: string, value: unknown): void;

  /* layers */
  selectLayer(id: string | null): void;
  addLayer<T extends LayerType>(type: T, overrides?: DeepPartial<LayerOfType<T>>): string | null;
  removeLayer(id: string): void;
  duplicateLayer(id: string): string | null;
  moveLayer(id: string, toIndex: number): void;
  toggleLayerVisibility(id: string): void;
  renameLayer(id: string, name: string): void;
  /** Deep-partial update; the result is validated and clamped. */
  updateLayer(id: string, changes: DeepPartial<Layer> | Record<string, unknown>, options?: CommitOptions): void;
  /** Inspector helper: set one field by dot path, tuple indices allowed ("transform.position.1"). */
  setLayerField(id: string, path: string, value: unknown): void;

  /* audio mappings */
  addMapping(layerId: string, partial?: Partial<AudioMapping>): string | null;
  updateMapping(layerId: string, mappingId: string, changes: Partial<AudioMapping>): void;
  removeMapping(layerId: string, mappingId: string): void;

  /* node graph */
  setGraph(graph: NodeGraph, options?: CommitOptions): void;
  addGraphNode<K extends GraphNodeKind>(kind: K, position: { x: number; y: number }, overrides?: Partial<Extract<GraphNode, { kind: K }>>): string | null;
  updateGraphNode(id: string, changes: Partial<GraphNode>, options?: CommitOptions): void;
  removeGraphNodes(ids: string[]): void;
  connectGraphNodes(source: string, target: string): string | null;
  removeGraphEdges(ids: string[]): void;
  setGraphEnabled(enabled: boolean): void;

  /* history */
  undo(): void;
  redo(): void;
}

const MAX_HISTORY = 80;
const COALESCE_MS = 1000;

function touch(scene: SceneConfig): SceneConfig {
  return { ...scene, meta: { ...scene.meta, updatedAt: new Date().toISOString() } };
}

function initialScene(): SceneConfig {
  return createPresetScene(DEFAULT_PRESET_ID);
}

export const useSceneStore = create<SceneStoreState>()((set, get) => {
  /** Central commit: pushes undo history (with coalescing) and bumps the revision. */
  const commit = (next: SceneConfig, options: CommitOptions = {}, extra: Partial<SceneStoreState> = {}) => {
    const state = get();
    if (next === state.scene) return;
    const now = Date.now();
    const source = options.source ?? "user";
    const coalesce =
      options.coalesceKey !== undefined &&
      options.coalesceKey === state.lastChange.coalesceKey &&
      now - state.lastChange.at < COALESCE_MS;
    set({
      scene: touch(next),
      past: coalesce ? state.past : [...state.past, state.scene].slice(-MAX_HISTORY),
      future: [],
      revision: state.revision + 1,
      lastChange: { source, at: now, coalesceKey: options.coalesceKey },
      ...extra,
    });
  };

  const mapLayer = (id: string, fn: (layer: Layer) => Layer | null, options?: CommitOptions) => {
    const { scene } = get();
    const index = scene.layers.findIndex((l) => l.id === id);
    if (index < 0) return;
    const updated = fn(scene.layers[index]);
    if (!updated || updated === scene.layers[index]) return;
    const layers = [...scene.layers];
    layers[index] = updated;
    commit({ ...scene, layers }, options);
  };

  /** Validates a modified layer, keeping its id/type. */
  const validLayer = (layer: Layer, candidate: unknown): Layer | null => {
    const result = sanitizeLayer({ ...(candidate as object), id: layer.id, type: layer.type }, layer.name);
    return result;
  };

  const mapGraph = (fn: (graph: NodeGraph) => NodeGraph, options?: CommitOptions) => {
    const { scene } = get();
    const graph = fn(scene.graph);
    if (graph === scene.graph) return;
    commit({ ...scene, graph }, { source: "graph", ...options });
  };

  const scene = initialScene();
  return {
    scene,
    selectedLayerId: scene.layers[0]?.id ?? null,
    past: [],
    future: [],
    revision: 0,
    lastChange: { source: "init", at: 0 },

    setScene(input, options) {
      const strict = SceneConfigSchema.safeParse(input);
      const result = strict.success ? { ok: true, value: strict.data, warnings: [] as string[] } : sanitizeSceneConfig(input);
      if (!result.ok) return { ok: false, warnings: result.warnings };
      const scene = result.value;
      const selected =
        options.selectLayerId !== undefined && (options.selectLayerId === null || scene.layers.some((l) => l.id === options.selectLayerId))
          ? options.selectLayerId
          : (scene.layers[0]?.id ?? null);
      if (options.resetHistory) {
        set({ scene, past: [], future: [], selectedLayerId: selected, revision: get().revision + 1, lastChange: { source: options.source, at: Date.now() } });
      } else {
        commit(scene, { source: options.source }, { selectedLayerId: selected });
      }
      return { ok: true, warnings: result.warnings };
    },

    loadPreset(presetId) {
      const scene = createPresetScene(presetId);
      get().setScene(scene, { source: "preset" });
    },

    applyPatch(patch, source = "ai") {
      const result = applyScenePatch(get().scene, patch);
      if (result.applied > 0) {
        const selected = result.addedLayerIds[0] ?? (result.scene.layers.some((l) => l.id === get().selectedLayerId) ? get().selectedLayerId : (result.scene.layers[0]?.id ?? null));
        commit(result.scene, { source }, { selectedLayerId: selected });
      }
      return result;
    },

    renameScene(name) {
      const trimmed = name.trim().slice(0, LIMITS.maxNameLength);
      if (!trimmed) return;
      commit({ ...get().scene, name: trimmed }, { coalesceKey: "scene:name" });
    },

    updateSection(section, changes, options) {
      const { scene } = get();
      const candidate = { ...scene, [section]: deepMerge(scene[section], changes) };
      const result = sanitizeSceneConfig(candidate);
      if (!result.ok) return;
      commit({ ...scene, [section]: result.value[section] }, { coalesceKey: `${section}:${Object.keys(changes).join(",")}`, ...options });
    },

    setSectionField(section, path, value) {
      const { scene } = get();
      const updated = setAtPath(scene[section], path, value) as Environment | PostSettings | SceneAudioSettings;
      const result = sanitizeSceneConfig({ ...scene, [section]: updated });
      if (!result.ok) return;
      commit({ ...scene, [section]: result.value[section] }, { coalesceKey: `${section}:${path}` });
    },

    selectLayer(id) {
      if (id !== null && !get().scene.layers.some((l) => l.id === id)) return;
      set({ selectedLayerId: id });
    },

    addLayer(type, overrides) {
      const { scene } = get();
      if (scene.layers.length >= LIMITS.maxLayers) return null;
      const layer = createLayer(type, overrides);
      commit({ ...scene, layers: [...scene.layers, layer] }, {}, { selectedLayerId: layer.id });
      return layer.id;
    },

    removeLayer(id) {
      const { scene, selectedLayerId } = get();
      const index = scene.layers.findIndex((l) => l.id === id);
      if (index < 0) return;
      const layers = scene.layers.filter((l) => l.id !== id);
      const nextSelected = selectedLayerId === id ? (layers[Math.min(index, layers.length - 1)]?.id ?? null) : selectedLayerId;
      commit({ ...scene, layers }, {}, { selectedLayerId: nextSelected });
    },

    duplicateLayer(id) {
      const { scene } = get();
      const index = scene.layers.findIndex((l) => l.id === id);
      if (index < 0 || scene.layers.length >= LIMITS.maxLayers) return null;
      const source = scene.layers[index];
      const copy = {
        ...structuredClone(source),
        id: createId("lyr"),
        name: `${source.name} copy`.slice(0, LIMITS.maxNameLength),
        reactivity: source.reactivity.map((m) => ({ ...m, id: createId("map") })),
      } as Layer;
      const layers = [...scene.layers];
      layers.splice(index + 1, 0, copy);
      commit({ ...scene, layers }, {}, { selectedLayerId: copy.id });
      return copy.id;
    },

    moveLayer(id, toIndex) {
      const { scene } = get();
      const from = scene.layers.findIndex((l) => l.id === id);
      if (from < 0) return;
      const to = Math.max(0, Math.min(scene.layers.length - 1, toIndex));
      if (from === to) return;
      const layers = [...scene.layers];
      const [layer] = layers.splice(from, 1);
      layers.splice(to, 0, layer);
      commit({ ...scene, layers });
    },

    toggleLayerVisibility(id) {
      mapLayer(id, (l) => ({ ...l, visible: !l.visible }) as Layer);
    },

    renameLayer(id, name) {
      const trimmed = name.trim().slice(0, LIMITS.maxNameLength);
      if (!trimmed) return;
      mapLayer(id, (l) => ({ ...l, name: trimmed }) as Layer, { coalesceKey: `${id}:name` });
    },

    updateLayer(id, changes, options) {
      mapLayer(id, (layer) => validLayer(layer, deepMerge(layer, changes)), {
        coalesceKey: `${id}:${Object.keys(changes).join(",")}`,
        ...options,
      });
    },

    setLayerField(id, path, value) {
      mapLayer(id, (layer) => validLayer(layer, setAtPath(layer, path, value)), { coalesceKey: `${id}:${path}` });
    },

    addMapping(layerId, partial) {
      const layer = get().scene.layers.find((l) => l.id === layerId);
      if (!layer || layer.reactivity.length >= LIMITS.maxMappingsPerLayer) return null;
      const mapping = createMapping(partial);
      mapLayer(layerId, (l) => validLayer(l, { ...l, reactivity: [...l.reactivity, mapping] }));
      return get().scene.layers.find((l) => l.id === layerId)?.reactivity.some((m) => m.id === mapping.id) ? mapping.id : null;
    },

    updateMapping(layerId, mappingId, changes) {
      mapLayer(
        layerId,
        (l) => validLayer(l, { ...l, reactivity: l.reactivity.map((m) => (m.id === mappingId ? { ...m, ...changes, id: m.id } : m)) }),
        { coalesceKey: `${layerId}:${mappingId}:${Object.keys(changes).join(",")}` },
      );
    },

    removeMapping(layerId, mappingId) {
      mapLayer(layerId, (l) => ({ ...l, reactivity: l.reactivity.filter((m) => m.id !== mappingId) }) as Layer);
    },

    setGraph(graph, options) {
      const { scene } = get();
      const result = sanitizeSceneConfig({ ...scene, graph });
      if (!result.ok) return;
      commit({ ...scene, graph: result.value.graph }, { source: "graph", ...options });
    },

    addGraphNode(kind, position, overrides) {
      const { scene } = get();
      if (scene.graph.nodes.length >= LIMITS.maxGraphNodes) return null;
      const node = createGraphNode(kind, { ...overrides, x: position.x, y: position.y } as Partial<Extract<GraphNode, { kind: typeof kind }>>);
      get().setGraph({ ...scene.graph, nodes: [...scene.graph.nodes, node] });
      return get().scene.graph.nodes.some((n) => n.id === node.id) ? node.id : null;
    },

    updateGraphNode(id, changes, options) {
      const { scene } = get();
      if (!scene.graph.nodes.some((n) => n.id === id)) return;
      const nodes = scene.graph.nodes.map((n) => (n.id === id ? ({ ...n, ...changes, id: n.id, kind: n.kind } as GraphNode) : n));
      get().setGraph({ ...scene.graph, nodes }, { coalesceKey: `node:${id}:${Object.keys(changes).join(",")}`, ...options });
    },

    removeGraphNodes(ids) {
      const remove = new Set(ids);
      mapGraph((g) => ({
        ...g,
        nodes: g.nodes.filter((n) => !remove.has(n.id)),
        edges: g.edges.filter((e) => !remove.has(e.source) && !remove.has(e.target)),
      }));
    },

    connectGraphNodes(source, target) {
      const { graph } = get().scene;
      if (source === target || graph.edges.length >= LIMITS.maxGraphEdges) return null;
      if (!graph.nodes.some((n) => n.id === source) || !graph.nodes.some((n) => n.id === target)) return null;
      const existing = graph.edges.find((e) => e.source === source && e.target === target);
      if (existing) return existing.id;
      const edge: GraphEdge = { id: createId("edge"), source, target };
      mapGraph((g) => ({ ...g, edges: [...g.edges, edge] }));
      return edge.id;
    },

    removeGraphEdges(ids) {
      const remove = new Set(ids);
      mapGraph((g) => ({ ...g, edges: g.edges.filter((e) => !remove.has(e.id)) }));
    },

    setGraphEnabled(enabled) {
      mapGraph((g) => (g.enabled === enabled ? g : { ...g, enabled }));
    },

    undo() {
      const { past, scene, future, selectedLayerId } = get();
      if (past.length === 0) return;
      const previous = past[past.length - 1];
      set({
        scene: previous,
        past: past.slice(0, -1),
        future: [scene, ...future].slice(0, MAX_HISTORY),
        revision: get().revision + 1,
        lastChange: { source: "history", at: Date.now() },
        selectedLayerId: previous.layers.some((l) => l.id === selectedLayerId) ? selectedLayerId : (previous.layers[0]?.id ?? null),
      });
    },

    redo() {
      const { past, scene, future, selectedLayerId } = get();
      if (future.length === 0) return;
      const next = future[0];
      set({
        scene: next,
        past: [...past, scene].slice(-MAX_HISTORY),
        future: future.slice(1),
        revision: get().revision + 1,
        lastChange: { source: "history", at: Date.now() },
        selectedLayerId: next.layers.some((l) => l.id === selectedLayerId) ? selectedLayerId : (next.layers[0]?.id ?? null),
      });
    },
  };
});

/* ------------------------------------------------------------------ */
/* Selectors                                                           */
/* ------------------------------------------------------------------ */

export const selectScene = (s: SceneStoreState) => s.scene;
export const selectLayers = (s: SceneStoreState) => s.scene.layers;
export const selectSelectedLayer = (s: SceneStoreState): Layer | null =>
  s.scene.layers.find((l) => l.id === s.selectedLayerId) ?? null;

export function useLayer(id: string | null): Layer | null {
  return useSceneStore((s) => (id ? (s.scene.layers.find((l) => l.id === id) ?? null) : null));
}

/** Non-React access for animation loops: always the latest scene, no subscription. */
export function getSceneSnapshot(): SceneConfig {
  return useSceneStore.getState().scene;
}

/** Pure helpers for the node-graph editor (connection rules, defaults). */
import { LAYER_TYPE_INFO } from "@/shared/scene/layers";
import { LIMITS, type GraphNodeKind, type Layer, type MappingTarget, type NodeGraph } from "@/shared/scene/schema";

export const NODE_KIND_META: Record<GraphNodeKind, { label: string; hasInput: boolean; hasOutput: boolean; accent: string }> = {
  audioBand: { label: "Audio Band", hasInput: false, hasOutput: true, accent: "bg-cyan" },
  multiply: { label: "Multiply", hasInput: true, hasOutput: true, accent: "bg-violet-soft" },
  clamp: { label: "Clamp", hasInput: true, hasOutput: true, accent: "bg-violet-soft" },
  smooth: { label: "Smooth", hasInput: true, hasOutput: true, accent: "bg-violet-soft" },
  remap: { label: "Remap", hasInput: true, hasOutput: true, accent: "bg-violet-soft" },
  visualParam: { label: "Visual Parameter", hasInput: true, hasOutput: false, accent: "bg-violet" },
};

/** True when `target` can already reach `source` (so source→target would close a loop). */
export function wouldCreateCycle(graph: NodeGraph, source: string, target: string): boolean {
  const stack = [target];
  const seen = new Set<string>();
  while (stack.length) {
    const id = stack.pop()!;
    if (id === source) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const e of graph.edges) if (e.source === id) stack.push(e.target);
  }
  return false;
}

/** null when the connection is allowed, otherwise a user-facing reason. */
export function validateConnection(graph: NodeGraph, source: string | null | undefined, target: string | null | undefined): string | null {
  if (!source || !target) return "Incomplete connection.";
  if (source === target) return "A node can't connect to itself.";
  const from = graph.nodes.find((n) => n.id === source);
  const to = graph.nodes.find((n) => n.id === target);
  if (!from || !to) return "That node no longer exists.";
  if (to.kind === "audioBand") return "Audio Band nodes are sources — they have no input.";
  if (from.kind === "visualParam") return "Visual Parameter nodes are outputs — they can't feed other nodes.";
  if (graph.edges.some((e) => e.source === source && e.target === target)) return "Those nodes are already connected.";
  if (graph.edges.length >= LIMITS.maxGraphEdges) return `The graph is limited to ${LIMITS.maxGraphEdges} connections.`;
  if (wouldCreateCycle(graph, source, target)) return "That connection would create a loop.";
  return null;
}

/** Preferred modulation target for a layer: scale when supported, else its first target. */
export function defaultTargetFor(layer: Layer | null | undefined): MappingTarget {
  if (!layer) return "scale";
  const targets = LAYER_TYPE_INFO[layer.type].targets;
  return targets.includes("scale") ? "scale" : targets[0];
}

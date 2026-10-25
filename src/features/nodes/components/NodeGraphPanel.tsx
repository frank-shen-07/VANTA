"use client";

/**
 * STUB — Agent 2 replaces this implementation.
 * Contract: React Flow editor for scene.graph, rendered inside the studio's
 * bottom drawer (fills its parent; parent sets the height). Edits go through
 * useSceneStore graph actions; evaluation happens in the shared modulation engine.
 */
export interface NodeGraphPanelProps {
  onClose?: () => void;
}

export function NodeGraphPanel(props: NodeGraphPanelProps) {
  void props;
  return <div className="flex h-full items-center justify-center text-xs text-fg-faint">Node graph unavailable</div>;
}

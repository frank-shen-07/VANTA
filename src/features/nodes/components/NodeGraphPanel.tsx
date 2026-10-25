"use client";

/**
 * React Flow editor for scene.graph (fills its parent drawer). Every edit goes
 * through useSceneStore graph actions; evaluation happens in the shared
 * modulation engine (the renderer calls computeModulation every frame), so
 * connections change the real visuals. Live node values are read from
 * liveModulation.nodeValues in rAF and written straight to the DOM.
 */
import "@xyflow/react/dist/style.css";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import { Plus, Wand2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Button, Toggle, cx } from "@/components/ui/primitives";
import { liveModulation } from "@/shared/modulation/engine";
import { createGraphNode } from "@/shared/scene/defaults";
import { LAYER_TYPE_INFO } from "@/shared/scene/layers";
import { AUDIO_BANDS, GRAPH_NODE_KINDS, LIMITS, type GraphNode, type GraphNodeKind } from "@/shared/scene/schema";
import { createId } from "@/shared/utils/object";
import { useSceneStore } from "@/store/sceneStore";
import { NODE_KIND_META, defaultTargetFor, validateConnection } from "../graph";

export interface NodeGraphPanelProps {
  onClose?: () => void;
}

type FlowData = { node: GraphNode };
type FlowNode = Node<FlowData>;

/** Live value elements by node id (written by the rAF loop). */
const valueElements = new Map<string, HTMLElement>();

const update = (id: string, changes: Partial<GraphNode>) => useSceneStore.getState().updateGraphNode(id, changes);

/* ------------------------------------------------------------------ */
/* Inline controls                                                     */
/* ------------------------------------------------------------------ */

function NumberField({ label, value, min, max, step, onCommit }: { label: string; value: number; min: number; max: number; step: number; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  const [prev, setPrev] = useState(value);
  if (prev !== value) {
    setPrev(value);
    setDraft(String(value));
  }
  const commit = (text: string) => {
    const n = Number(text);
    if (text.trim() !== "" && Number.isFinite(n)) onCommit(Math.min(max, Math.max(min, n)));
  };
  return (
    <label className="flex items-center justify-between gap-2">
      <span className="text-fg-muted">{label}</span>
      <input
        type="number"
        className="nodrag h-6 w-16 rounded bg-surface-3 px-1 text-right font-mono text-[11px] text-fg outline-none ring-1 ring-line focus:ring-violet/60"
        value={draft}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          setDraft(e.target.value);
          commit(e.target.value);
        }}
        onBlur={() => setDraft(String(value))}
      />
    </label>
  );
}

function SelectField<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <label className="flex items-center justify-between gap-2">
      <span className="text-fg-muted">{label}</span>
      <select
        className="nodrag h-6 max-w-[8.5rem] rounded bg-surface-3 px-1 text-[11px] text-fg outline-none ring-1 ring-line focus:ring-violet/60"
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-surface-2">
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function VisualParamControls({ node }: { node: Extract<GraphNode, { kind: "visualParam" }> }) {
  const layers = useSceneStore((s) => s.scene.layers);
  const layer = layers.find((l) => l.id === node.layerId) ?? null;
  const layerOptions = layers.map((l) => ({ value: l.id, label: l.name }));
  if (!layer) layerOptions.unshift({ value: node.layerId, label: "— missing layer —" });
  const targets = layer ? LAYER_TYPE_INFO[layer.type].targets : [node.target];
  return (
    <>
      <SelectField
        label="Layer"
        value={node.layerId}
        options={layerOptions}
        onChange={(layerId) => {
          const next = layers.find((l) => l.id === layerId);
          if (!next) return;
          const allowed = LAYER_TYPE_INFO[next.type].targets;
          update(node.id, { layerId, target: allowed.includes(node.target) ? node.target : defaultTargetFor(next) } as Partial<GraphNode>);
        }}
      />
      <SelectField
        label="Target"
        value={node.target}
        options={targets.map((t) => ({ value: t, label: t }))}
        onChange={(target) => update(node.id, { target } as Partial<GraphNode>)}
      />
      {!layer ? <div className="text-[10px] text-warning">Pick a layer — this output does nothing.</div> : null}
    </>
  );
}

function NodeControls({ node }: { node: GraphNode }) {
  switch (node.kind) {
    case "audioBand":
      return <SelectField label="Band" value={node.band} options={AUDIO_BANDS.map((b) => ({ value: b, label: b }))} onChange={(band) => update(node.id, { band } as Partial<GraphNode>)} />;
    case "multiply":
      return <NumberField label="Factor" value={node.factor} min={-10} max={10} step={0.1} onCommit={(factor) => update(node.id, { factor } as Partial<GraphNode>)} />;
    case "clamp":
      return (
        <>
          <NumberField label="Min" value={node.min} min={-10} max={10} step={0.1} onCommit={(min) => update(node.id, { min } as Partial<GraphNode>)} />
          <NumberField label="Max" value={node.max} min={-10} max={10} step={0.1} onCommit={(max) => update(node.id, { max } as Partial<GraphNode>)} />
        </>
      );
    case "smooth":
      return <NumberField label="Amount" value={node.amount} min={0} max={0.99} step={0.05} onCommit={(amount) => update(node.id, { amount } as Partial<GraphNode>)} />;
    case "remap":
      return (
        <>
          <NumberField label="In min" value={node.inMin} min={-10} max={10} step={0.1} onCommit={(inMin) => update(node.id, { inMin } as Partial<GraphNode>)} />
          <NumberField label="In max" value={node.inMax} min={-10} max={10} step={0.1} onCommit={(inMax) => update(node.id, { inMax } as Partial<GraphNode>)} />
          <NumberField label="Out min" value={node.outMin} min={-10} max={10} step={0.1} onCommit={(outMin) => update(node.id, { outMin } as Partial<GraphNode>)} />
          <NumberField label="Out max" value={node.outMax} min={-10} max={10} step={0.1} onCommit={(outMax) => update(node.id, { outMax } as Partial<GraphNode>)} />
        </>
      );
    case "visualParam":
      return <VisualParamControls node={node} />;
  }
}

/* ------------------------------------------------------------------ */
/* Custom node                                                         */
/* ------------------------------------------------------------------ */

const handleStyle: CSSProperties = { width: 10, height: 10, background: "#22d3ee", border: "2px solid #14141b" };

function GraphNodeView({ data, selected }: NodeProps<FlowNode>) {
  const node = data.node;
  const meta = NODE_KIND_META[node.kind];
  return (
    <div
      className={cx("w-48 rounded-lg bg-surface-2/95 text-[11px] text-fg shadow-[var(--shadow-pop)] ring-1", selected ? "ring-violet" : "ring-line-strong")}
      data-testid={`graph-node-${node.kind}`}
    >
      {meta.hasInput ? <Handle type="target" position={Position.Left} style={handleStyle} /> : null}
      <div className="flex items-center justify-between gap-2 border-b border-line px-2 py-1.5">
        <span className="flex items-center gap-1.5 font-medium">
          <span className={cx("h-1.5 w-1.5 rounded-full", meta.accent)} />
          {meta.label}
        </span>
        <span
          className="font-mono text-[10.5px] tabular-nums text-cyan-soft"
          title="Live output"
          ref={(el) => {
            if (el) valueElements.set(node.id, el);
            else valueElements.delete(node.id);
          }}
        >
          —
        </span>
      </div>
      <div className="nodrag space-y-1 p-2">
        <NodeControls node={node} />
      </div>
      {meta.hasOutput ? <Handle type="source" position={Position.Right} style={handleStyle} /> : null}
    </div>
  );
}

const nodeTypes = Object.fromEntries(GRAPH_NODE_KINDS.map((k) => [k, GraphNodeView])) as Record<GraphNodeKind, typeof GraphNodeView>;

function toFlowNodes(nodes: GraphNode[], prev: FlowNode[]): FlowNode[] {
  const byId = new Map(prev.map((n) => [n.id, n]));
  return nodes.map((node) => {
    const old = byId.get(node.id);
    return {
      id: node.id,
      type: node.kind,
      position: old?.dragging ? old.position : { x: node.x, y: node.y },
      data: { node },
      ...(old?.measured ? { measured: old.measured } : {}),
      ...(old?.selected ? { selected: true } : {}),
      ...(old?.dragging ? { dragging: true } : {}),
    };
  });
}

/* ------------------------------------------------------------------ */
/* Editor                                                              */
/* ------------------------------------------------------------------ */

function GraphEditor({ onClose }: NodeGraphPanelProps) {
  const graph = useSceneStore((s) => s.scene.graph);
  const { screenToFlowPosition } = useReactFlow();
  const container = useRef<HTMLDivElement>(null);
  const [flowNodes, setFlowNodes] = useState<FlowNode[]>(() => toFlowNodes(graph.nodes, []));
  const [synced, setSynced] = useState(graph.nodes);
  const [selectedEdges, setSelectedEdges] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useState<string | null>(null);

  if (synced !== graph.nodes) {
    setSynced(graph.nodes);
    setFlowNodes((prev) => toFlowNodes(graph.nodes, prev));
  }

  const edges: Edge[] = useMemo(
    () =>
      graph.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        selected: !!selectedEdges[e.id],
        animated: graph.enabled,
        style: { stroke: graph.enabled ? "#8b5cf6" : "#4b4b5a", strokeWidth: 2 },
      })),
    [graph.edges, graph.enabled, selectedEdges],
  );

  // Live node values: rAF + direct DOM writes (no React state per frame).
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      for (const [id, el] of valueElements) {
        const v = liveModulation.nodeValues.get(id);
        const text = v === undefined ? "—" : v.toFixed(2);
        if (el.textContent !== text) el.textContent = text;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 3500);
    return () => clearTimeout(t);
  }, [notice]);

  const center = () => {
    const rect = container.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
  };

  const selectedLayer = () => {
    const { scene, selectedLayerId } = useSceneStore.getState();
    return scene.layers.find((l) => l.id === selectedLayerId) ?? scene.layers[0] ?? null;
  };

  const addNode = (kind: GraphNodeKind) => {
    const store = useSceneStore.getState();
    if (store.scene.graph.nodes.length >= LIMITS.maxGraphNodes) return setNotice(`The graph is limited to ${LIMITS.maxGraphNodes} nodes.`);
    const c = center();
    const jitter = (store.scene.graph.nodes.length % 5) * 24;
    const position = { x: Math.round(c.x - 96 + jitter), y: Math.round(c.y - 40 + jitter) };
    if (kind === "visualParam") {
      const layer = selectedLayer();
      store.addGraphNode("visualParam", position, layer ? { layerId: layer.id, target: defaultTargetFor(layer) } : {});
    } else {
      store.addGraphNode(kind, position);
    }
  };

  const addExampleChain = () => {
    const store = useSceneStore.getState();
    const layer = selectedLayer();
    if (!layer) return setNotice("Add a layer first — the chain needs a target.");
    const g = store.scene.graph;
    if (g.nodes.length + 4 > LIMITS.maxGraphNodes) return setNotice("Not enough room for four more nodes.");
    const c = center();
    const y = Math.round(c.y - 50);
    const x = Math.round(c.x);
    const band = createGraphNode("audioBand", { band: "bass", x: x - 470, y });
    const smooth = createGraphNode("smooth", { amount: 0.6, x: x - 230, y });
    const mul = createGraphNode("multiply", { factor: 1.5, x: x + 10, y });
    const sink = createGraphNode("visualParam", { layerId: layer.id, target: defaultTargetFor(layer), x: x + 250, y });
    store.setGraph({
      ...g,
      enabled: true,
      nodes: [...g.nodes, band, smooth, mul, sink],
      edges: [
        ...g.edges,
        { id: createId("edge"), source: band.id, target: smooth.id },
        { id: createId("edge"), source: smooth.id, target: mul.id },
        { id: createId("edge"), source: mul.id, target: sink.id },
      ],
    });
  };

  const onNodesChange = (changes: NodeChange<FlowNode>[]) => {
    const kept = changes.filter((c) => c.type !== "remove" && c.type !== "add" && c.type !== "replace");
    if (kept.length) setFlowNodes((nds) => applyNodeChanges(kept, nds));
  };

  const onEdgesChange = (changes: EdgeChange[]) => {
    const selects = changes.filter((c) => c.type === "select");
    if (selects.length)
      setSelectedEdges((prev) => {
        const next = { ...prev };
        for (const c of selects) if (c.type === "select") next[c.id] = c.selected;
        return next;
      });
  };

  const onConnect = (c: Connection) => {
    const reason = validateConnection(useSceneStore.getState().scene.graph, c.source, c.target);
    if (reason) return setNotice(reason);
    useSceneStore.getState().connectGraphNodes(c.source, c.target);
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-1" data-testid="node-graph-panel">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-fg-faint">Node graph</span>
        <Toggle label="" checked={graph.enabled} onChange={(v) => useSceneStore.getState().setGraphEnabled(v)} hint="Enable graph modulation" />
        <span className="text-[11px] text-fg-muted">{graph.enabled ? "On" : "Off"}</span>
        <div className="mx-1 h-4 w-px bg-line" />
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {GRAPH_NODE_KINDS.map((kind) => (
            <Button key={kind} size="xs" variant="ghost" onClick={() => addNode(kind)} title={`Add ${NODE_KIND_META[kind].label}`} data-testid={`add-node-${kind}`}>
              <Plus size={11} />
              {NODE_KIND_META[kind].label}
            </Button>
          ))}
          <Button size="xs" variant="accent" onClick={addExampleChain} title="Bass → Smooth → Multiply → selected layer scale" data-testid="add-example-chain">
            <Wand2 size={11} />
            Example chain
          </Button>
        </div>
        {notice ? (
          <span className="max-w-xs truncate text-[11px] text-warning" role="status" title={notice}>
            {notice}
          </span>
        ) : null}
        {onClose ? (
          <Button size="xs" variant="ghost" icon onClick={onClose} aria-label="Close node graph" title="Close">
            <X size={12} />
          </Button>
        ) : null}
      </div>
      <div ref={container} className="relative min-h-0 flex-1">
        <ReactFlow<FlowNode, Edge>
          nodes={flowNodes}
          edges={edges}
          nodeTypes={nodeTypes}
          colorMode="dark"
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          isValidConnection={(c) => validateConnection(useSceneStore.getState().scene.graph, c.source, c.target) === null}
          onNodeDragStop={(_e, _node, dragged) => {
            for (const n of dragged) update(n.id, { x: Math.round(n.position.x), y: Math.round(n.position.y) });
          }}
          onDelete={({ nodes, edges: removed }) => {
            const store = useSceneStore.getState();
            if (removed.length) store.removeGraphEdges(removed.map((e) => e.id));
            if (nodes.length) store.removeGraphNodes(nodes.map((n) => n.id));
          }}
          deleteKeyCode={["Backspace", "Delete"]}
          fitView
          fitViewOptions={{ maxZoom: 1, padding: 0.2 }}
          minZoom={0.25}
          maxZoom={2}
          style={{ background: "transparent" }}
        >
          <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="rgba(255,255,255,0.09)" />
          <Controls showInteractive={false} />
        </ReactFlow>
        {graph.nodes.length === 0 ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-fg-faint">
            Add nodes above, or try the example chain (Bass → Smooth → Multiply → layer scale).
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function NodeGraphPanel(props: NodeGraphPanelProps) {
  return (
    <ReactFlowProvider>
      <GraphEditor {...props} />
    </ReactFlowProvider>
  );
}

"use client";

/**
 * Studio root. OWNERSHIP: Agent 1 (Frontend UI & 3D).
 * Mounts AudioEngineProvider, PersistenceBoot and AudioDropOverlay exactly once.
 */
import { Eye, EyeOff, Redo2, Undo2 } from "lucide-react";
import { AudioDropOverlay } from "@/features/audio/components/AudioDropOverlay";
import { AudioPlayerBar } from "@/features/audio/components/AudioPlayerBar";
import { AudioEngineProvider } from "@/features/audio/AudioEngineProvider";
import { ExportMenu } from "@/features/export/components/ExportMenu";
import { NodeGraphPanel } from "@/features/nodes/components/NodeGraphPanel";
import { PersistenceBoot } from "@/features/persistence/PersistenceBoot";
import { ProjectMenu } from "@/features/persistence/components/ProjectMenu";
import { Viewport } from "@/features/renderer/Viewport";
import { Button, SectionHeader, cx } from "@/components/ui/primitives";
import { PRESETS } from "@/shared/scene/presets";
import { useEditorStore } from "@/store/editorStore";
import { useSceneStore } from "@/store/sceneStore";

function LayersPanel() {
  const layers = useSceneStore((s) => s.scene.layers);
  const selected = useSceneStore((s) => s.selectedLayerId);
  const selectLayer = useSceneStore((s) => s.selectLayer);
  const toggle = useSceneStore((s) => s.toggleLayerVisibility);
  const loadPreset = useSceneStore((s) => s.loadPreset);
  return (
    <aside className="flex w-60 shrink-0 flex-col overflow-y-auto border-r border-line bg-surface-1">
      <SectionHeader title="Layers" />
      <ul className="px-2">
        {[...layers].reverse().map((layer) => (
          <li key={layer.id}>
            <div
              className={cx(
                "flex h-8 cursor-pointer items-center justify-between rounded-md px-2 text-xs",
                layer.id === selected ? "bg-violet/15 text-fg" : "text-fg-muted hover:bg-surface-3",
              )}
              onClick={() => selectLayer(layer.id)}
            >
              <span className="truncate">{layer.name}</span>
              <Button
                variant="ghost"
                size="xs"
                icon
                aria-label={layer.visible ? "Hide layer" : "Show layer"}
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(layer.id);
                }}
              >
                {layer.visible ? <Eye size={13} /> : <EyeOff size={13} />}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <SectionHeader title="Presets" className="mt-3" />
      <div className="grid grid-cols-2 gap-2 px-2 pb-3">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => loadPreset(p.id)}
            className="rounded-md bg-surface-2 p-2 text-left ring-1 ring-line hover:ring-line-strong"
            title={p.description}
          >
            <span className="mb-1.5 block h-6 rounded" style={{ background: `linear-gradient(120deg, ${p.swatch[0]}, ${p.swatch[1]})` }} />
            <span className="block truncate text-[11px] text-fg">{p.name}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}

export function Studio() {
  const sceneName = useSceneStore((s) => s.scene.name);
  const renameScene = useSceneStore((s) => s.renameScene);
  const canUndo = useSceneStore((s) => s.past.length > 0);
  const canRedo = useSceneStore((s) => s.future.length > 0);
  const undo = useSceneStore((s) => s.undo);
  const redo = useSceneStore((s) => s.redo);
  const bottomPanel = useEditorStore((s) => s.bottomPanel);
  const setBottomPanel = useEditorStore((s) => s.setBottomPanel);
  return (
    <AudioEngineProvider>
      <PersistenceBoot />
      <div className="flex h-full flex-col">
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-surface-1 px-4">
          <span className="text-xs font-semibold tracking-[0.4em]">VANTA</span>
          <input
            key={sceneName}
            aria-label="Scene name"
            defaultValue={sceneName}
            onBlur={(e) => renameScene(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            className="h-7 w-48 rounded-md bg-transparent px-2 text-xs text-fg outline-none hover:bg-surface-3 focus:bg-surface-3"
          />
          <div className="ml-auto flex items-center gap-2">
            <ProjectMenu />
            <ExportMenu />
            <Button variant="ghost" size="sm" icon aria-label="Undo" disabled={!canUndo} onClick={undo}>
              <Undo2 size={14} />
            </Button>
            <Button variant="ghost" size="sm" icon aria-label="Redo" disabled={!canRedo} onClick={redo}>
              <Redo2 size={14} />
            </Button>
            <Button variant="ghost" size="sm" active={bottomPanel === "nodes"} onClick={() => setBottomPanel(bottomPanel === "nodes" ? "none" : "nodes")}>
              Nodes
            </Button>
          </div>
        </header>
        <div className="flex min-h-0 flex-1">
          <LayersPanel />
          <main className="relative min-w-0 flex-1">
            <Viewport />
          </main>
        </div>
        {bottomPanel === "nodes" ? (
          <div className="h-[280px] shrink-0 border-t border-line bg-surface-1">
            <NodeGraphPanel onClose={() => setBottomPanel("none")} />
          </div>
        ) : null}
        <AudioPlayerBar className="h-16 shrink-0 border-t border-line bg-surface-1" />
      </div>
      <AudioDropOverlay />
    </AudioEngineProvider>
  );
}

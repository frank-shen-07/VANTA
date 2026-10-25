"use client";

/**
 * Studio root. OWNERSHIP: Agent 1 (Frontend UI & 3D) — this placeholder shows
 * where every integration slot is mounted; replace the layout freely but keep
 * mounting AudioEngineProvider, PersistenceBoot and AudioDropOverlay exactly once.
 */
import { AudioDropOverlay } from "@/features/audio/components/AudioDropOverlay";
import { AudioPlayerBar } from "@/features/audio/components/AudioPlayerBar";
import { AudioEngineProvider } from "@/features/audio/AudioEngineProvider";
import { ExportMenu } from "@/features/export/components/ExportMenu";
import { PersistenceBoot } from "@/features/persistence/PersistenceBoot";
import { ProjectMenu } from "@/features/persistence/components/ProjectMenu";
import { useSceneStore } from "@/store/sceneStore";

export function Studio() {
  const scene = useSceneStore((s) => s.scene);
  return (
    <AudioEngineProvider>
      <PersistenceBoot />
      <div className="flex h-full flex-col">
        <header className="flex h-12 items-center justify-between border-b border-line bg-surface-1 px-4">
          <span className="text-xs font-semibold tracking-[0.4em]">VANTA</span>
          <span className="text-xs text-fg-muted">{scene.name}</span>
          <div className="flex items-center gap-2">
            <ProjectMenu />
            <ExportMenu />
          </div>
        </header>
        <main className="flex-1" />
        <AudioPlayerBar />
      </div>
      <AudioDropOverlay />
    </AudioEngineProvider>
  );
}

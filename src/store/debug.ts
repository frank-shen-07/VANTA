/**
 * Automation hook (owned by the lead orchestrator). Exposes the live stores and
 * runtime services on `window.__VANTA__` in development, or in any build when
 * the page is opened with `?debug`. Used by e2e/smoke.mjs to verify the real
 * pipelines (audio analysis, modulation, export) in a browser.
 */
import { audioBus } from "@/shared/runtime/audioBus";
import { getAudioController, getExportController, getRenderer } from "@/shared/runtime/registry";
import { liveModulation } from "@/shared/modulation/engine";
import { PRESETS } from "@/shared/scene/presets";
import { useEditorStore } from "./editorStore";
import { useSceneStore } from "./sceneStore";

export function installDebugHook(): void {
  if (typeof window === "undefined") return;
  const enabled = process.env.NODE_ENV !== "production" || new URLSearchParams(window.location.search).has("debug");
  if (!enabled) return;
  (window as unknown as Record<string, unknown>).__VANTA__ = {
    scene: useSceneStore,
    editor: useEditorStore,
    audioBus,
    liveModulation,
    presets: PRESETS.map((p) => p.id),
    getAudioController,
    getExportController,
    getRenderer,
  };
}

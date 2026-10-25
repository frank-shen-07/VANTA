"use client";

/**
 * Global studio keyboard shortcuts (lead orchestrator, integration):
 * Space play/pause · ⌘/Ctrl+Z undo · ⇧⌘Z / Ctrl+Y redo · Delete/Backspace remove layer ·
 * ⌘/Ctrl+D duplicate layer · F fullscreen viewport. Ignored while typing in form fields.
 */
import { useEffect } from "react";
import { getAudioController } from "@/shared/runtime/registry";
import { useSceneStore } from "@/store/sceneStore";

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

export function useStudioShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const mod = e.metaKey || e.ctrlKey;
      const store = useSceneStore.getState();
      const key = e.key.toLowerCase();
      if (mod && key === "z") {
        e.preventDefault();
        if (e.shiftKey) store.redo();
        else store.undo();
      } else if (mod && key === "y") {
        e.preventDefault();
        store.redo();
      } else if (mod && key === "d") {
        e.preventDefault();
        if (store.selectedLayerId) store.duplicateLayer(store.selectedLayerId);
      } else if (!mod && (e.key === "Delete" || e.key === "Backspace")) {
        if (store.selectedLayerId) {
          e.preventDefault();
          store.removeLayer(store.selectedLayerId);
        }
      } else if (!mod && e.code === "Space") {
        e.preventDefault();
        void getAudioController()?.togglePlay();
      } else if (!mod && key === "f") {
        const el = document.getElementById("vanta-viewport");
        if (document.fullscreenElement) void document.exitFullscreen();
        else void el?.requestFullscreen?.();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

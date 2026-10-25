"use client";

/**
 * Mounted once at the studio root. Restores the autosave slot on first mount
 * (module-level guard keeps it StrictMode-safe), then autosaves the scene
 * (debounced ~800 ms) whenever useSceneStore.revision changes. Renders nothing.
 * TODO(agent3): share-link (#scene=) restore is not implemented yet.
 */
import { useEffect } from "react";
import { useSceneStore } from "@/store/sceneStore";
import { readAutosave, writeAutosave } from "./autosave";

const AUTOSAVE_DEBOUNCE_MS = 800;
let restored = false;

export function PersistenceBoot() {
  useEffect(() => {
    if (!restored) {
      restored = true;
      const saved = readAutosave();
      if (saved.ok) useSceneStore.getState().setScene(saved.scene, { source: "import", resetHistory: true });
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      writeAutosave(useSceneStore.getState().scene);
    };
    const unsubscribe = useSceneStore.subscribe((state, prev) => {
      if (state.revision === prev.revision || state.lastChange.source === "init") return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, AUTOSAVE_DEBOUNCE_MS);
    });
    const onHide = () => timer && flush();
    window.addEventListener("pagehide", onHide);
    return () => {
      unsubscribe();
      window.removeEventListener("pagehide", onHide);
      if (timer) flush();
    };
  }, []);
  return null;
}

"use client";

/**
 * Mounted once at the studio root. On first mount (module-level guard keeps it
 * StrictMode-safe) it loads a `#scene=` share link — then clears the hash —
 * or else restores the autosave slot. Afterwards it autosaves the scene
 * (debounced ~800 ms) whenever useSceneStore.revision changes. Renders nothing.
 */
import { useEffect } from "react";
import { useSceneStore } from "@/store/sceneStore";
import { readAutosave, writeAutosave } from "./autosave";
import { decodeSceneToken, shareTokenFromHash } from "./shareLink";

const AUTOSAVE_DEBOUNCE_MS = 800;
let boot: Promise<void> | null = null;

async function restoreInitialScene(): Promise<void> {
  const token = shareTokenFromHash(window.location.hash);
  if (token !== null) {
    try {
      history.replaceState(null, "", window.location.pathname + window.location.search);
    } catch {
      /* ignore */
    }
    const shared = await decodeSceneToken(token);
    if (shared.ok) {
      useSceneStore.getState().setScene(shared.scene, { source: "import", resetHistory: true });
      return;
    }
    console.warn(`[VANTA] ${shared.error}`);
  }
  const saved = readAutosave();
  if (saved.ok) useSceneStore.getState().setScene(saved.scene, { source: "import", resetHistory: true });
}

export function PersistenceBoot() {
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let unsubscribe = () => {};
    const flush = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      writeAutosave(useSceneStore.getState().scene);
    };
    const onHide = () => timer && flush();
    boot ??= restoreInitialScene().catch(() => {});
    void boot.then(() => {
      if (disposed) return;
      unsubscribe = useSceneStore.subscribe((state, prev) => {
        if (state.revision === prev.revision || state.lastChange.source === "init") return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(flush, AUTOSAVE_DEBOUNCE_MS);
      });
      window.addEventListener("pagehide", onHide);
    });
    return () => {
      disposed = true;
      unsubscribe();
      window.removeEventListener("pagehide", onHide);
      if (timer) flush();
    };
  }, []);
  return null;
}

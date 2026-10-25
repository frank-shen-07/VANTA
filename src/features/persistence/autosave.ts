/** Autosave slot in localStorage. Every storage access is guarded (quota, private mode). */
import { createSceneFile, parseSceneFile } from "@/shared/scene/file";
import type { SceneConfig } from "@/shared/scene/schema";

export const AUTOSAVE_KEY = "vanta:autosave:v1";

function storage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function writeAutosave(scene: SceneConfig, store: Storage | null = storage()): { ok: boolean; error?: string } {
  if (!store) return { ok: false, error: "Browser storage is unavailable." };
  try {
    store.setItem(AUTOSAVE_KEY, JSON.stringify(createSceneFile(scene)));
    return { ok: true };
  } catch {
    return { ok: false, error: "Autosave failed — browser storage may be full." };
  }
}

export function readAutosave(store: Storage | null = storage()): { ok: true; scene: SceneConfig; warnings: string[] } | { ok: false; error: string } {
  if (!store) return { ok: false, error: "Browser storage is unavailable." };
  try {
    const raw = store.getItem(AUTOSAVE_KEY);
    if (!raw) return { ok: false, error: "No autosave." };
    return parseSceneFile(JSON.parse(raw));
  } catch {
    return { ok: false, error: "The autosaved scene could not be read." };
  }
}

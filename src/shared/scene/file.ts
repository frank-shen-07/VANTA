/**
 * On-disk / share-link envelope for scenes — owned by the lead orchestrator.
 * Persistence code (Agent 3) must read files through `parseSceneFile`, which
 * sanitizes the embedded scene.
 */
import { z } from "zod";
import { isPlainObject } from "@/shared/utils/object";
import { sanitizeSceneConfig } from "./sanitize";
import type { SceneConfig } from "./schema";

export const SCENE_FILE_FORMAT = "vanta-scene" as const;
export const SCENE_FILE_EXTENSION = ".vanta.json";

export const SceneFileEnvelopeSchema = z.object({
  format: z.literal(SCENE_FILE_FORMAT),
  formatVersion: z.literal(1),
  exportedAt: z.string().max(40),
  app: z.string().max(40),
  scene: z.unknown(),
});

export function createSceneFile(scene: SceneConfig): z.infer<typeof SceneFileEnvelopeSchema> {
  return { format: SCENE_FILE_FORMAT, formatVersion: 1, exportedAt: new Date().toISOString(), app: "VANTA", scene };
}

/**
 * Parses either a scene-file envelope or a bare SceneConfig object.
 * Returns ok:false with an error message when the data is not a VANTA scene at all.
 */
export function parseSceneFile(data: unknown):
  | { ok: true; scene: SceneConfig; warnings: string[] }
  | { ok: false; error: string } {
  if (!isPlainObject(data)) return { ok: false, error: "File does not contain a JSON object." };
  const raw = data.format === SCENE_FILE_FORMAT ? data.scene : data;
  if (!isPlainObject(raw) || !("layers" in raw || "environment" in raw)) {
    return { ok: false, error: "This JSON file is not a VANTA scene." };
  }
  const result = sanitizeSceneConfig(raw);
  if (!result.ok) return { ok: false, error: result.warnings.at(-1) ?? "Scene could not be repaired." };
  return { ok: true, scene: result.value, warnings: result.warnings };
}

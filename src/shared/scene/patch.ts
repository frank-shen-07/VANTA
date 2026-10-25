/**
 * Targeted scene edits — owned by the lead orchestrator.
 *
 * AI refinement returns a ScenePatch instead of a whole scene. The client
 * applies the patch to the *latest* scene in the store, so manual edits made
 * while the request was in flight (and everything the patch does not mention)
 * are preserved.
 */
import { z } from "zod";
import { deepMerge, isPlainObject } from "@/shared/utils/object";
import { sanitizeLayer, sanitizeSceneConfig } from "./sanitize";
import { IdSchema, LIMITS, NameSchema, type SceneConfig } from "./schema";

const Changes = z.record(z.string(), z.unknown());

export const ScenePatchOpSchema = z.discriminatedUnion("op", [
  /** Deep-partial update of one layer. `type` and `id` cannot be changed. */
  z.object({ op: z.literal("updateLayer"), layerId: IdSchema, changes: Changes }),
  /** Adds a layer; it is sanitized (unsupported types are rejected). */
  z.object({ op: z.literal("addLayer"), layer: Changes, index: z.number().int().min(0).max(LIMITS.maxLayers).optional() }),
  z.object({ op: z.literal("removeLayer"), layerId: IdSchema }),
  z.object({ op: z.literal("updateEnvironment"), changes: Changes }),
  z.object({ op: z.literal("updatePost"), changes: Changes }),
  z.object({ op: z.literal("updateAudio"), changes: Changes }),
  z.object({ op: z.literal("renameScene"), name: NameSchema }),
]);
export type ScenePatchOp = z.infer<typeof ScenePatchOpSchema>;

export const ScenePatchSchema = z.object({
  ops: z.array(ScenePatchOpSchema).max(40),
});
export type ScenePatch = z.infer<typeof ScenePatchSchema>;

export interface ApplyPatchResult {
  scene: SceneConfig;
  /** Number of ops that changed the scene. */
  applied: number;
  warnings: string[];
  /** IDs of layers added by the patch (useful for selecting them). */
  addedLayerIds: string[];
}

/** Applies a patch immutably. Invalid ops are skipped with a warning; the result is always a valid scene. */
export function applyScenePatch(scene: SceneConfig, patch: ScenePatch): ApplyPatchResult {
  const warnings: string[] = [];
  const addedLayerIds: string[] = [];
  let applied = 0;
  let next: SceneConfig = { ...scene, layers: [...scene.layers] };

  patch.ops.forEach((op, i) => {
    const where = `ops.${i} (${op.op})`;
    switch (op.op) {
      case "updateLayer": {
        const index = next.layers.findIndex((l) => l.id === op.layerId);
        if (index < 0) return void warnings.push(`${where}: layer ${op.layerId} not found`);
        const current = next.layers[index];
        const { id: _id, type: _type, ...changes } = op.changes;
        void _id;
        void _type;
        const merged = deepMerge(current, changes);
        const layerWarnings: string[] = [];
        const layer = sanitizeLayer({ ...merged, id: current.id, type: current.type }, `layer ${current.name}`, layerWarnings);
        warnings.push(...layerWarnings.map((w) => `${where}: ${w}`));
        if (!layer) return;
        next.layers[index] = layer;
        applied++;
        return;
      }
      case "addLayer": {
        if (next.layers.length >= LIMITS.maxLayers) return void warnings.push(`${where}: layer limit (${LIMITS.maxLayers}) reached`);
        const used = new Set(next.layers.map((l) => l.id));
        const layerWarnings: string[] = [];
        const layer = sanitizeLayer(op.layer, "new layer", layerWarnings, used);
        warnings.push(...layerWarnings.map((w) => `${where}: ${w}`));
        if (!layer) return;
        const at = op.index === undefined ? next.layers.length : Math.min(op.index, next.layers.length);
        next.layers.splice(at, 0, layer);
        addedLayerIds.push(layer.id);
        applied++;
        return;
      }
      case "removeLayer": {
        const before = next.layers.length;
        next.layers = next.layers.filter((l) => l.id !== op.layerId);
        if (next.layers.length === before) return void warnings.push(`${where}: layer ${op.layerId} not found`);
        applied++;
        return;
      }
      case "updateEnvironment":
      case "updatePost":
      case "updateAudio": {
        const key = op.op === "updateEnvironment" ? "environment" : op.op === "updatePost" ? "post" : "audio";
        if (!isPlainObject(op.changes)) return;
        next = { ...next, [key]: deepMerge(next[key], op.changes) };
        applied++;
        return;
      }
      case "renameScene": {
        next = { ...next, name: op.name };
        applied++;
        return;
      }
    }
  });

  // Re-validate the whole scene (clamps any out-of-range environment/post/audio values).
  const result = sanitizeSceneConfig(next);
  warnings.push(...result.warnings);
  const finalScene = result.ok ? result.value : scene;
  if (!result.ok) warnings.push("Patch produced an invalid scene and was discarded.");
  return { scene: finalScene, applied: result.ok ? applied : 0, warnings, addedLayerIds: result.ok ? addedLayerIds : [] };
}

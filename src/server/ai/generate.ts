/**
 * Scene generation orchestrator. CURRENT STATE: heuristic generator only.
 * TODO(agent3): wire the LLM path (draft.ts holds the registry-driven draft
 * format + expansion; llm.ts / prompt.ts are not written yet).
 */
import type { SceneGenerationRequest, SceneGenerationResponse } from "@/shared/ai/contract";
import { applyScenePatch } from "@/shared/scene/patch";
import { readAIConfig } from "./config";
import { generateHeuristicScene, refineHeuristicScene } from "./heuristic";

export function runSceneGeneration(request: SceneGenerationRequest): SceneGenerationResponse {
  const config = readAIConfig();
  const note = config.configured
    ? "LLM generation is not enabled in this build yet; used the built-in keyword generator."
    : "No AI model configured; used the built-in keyword generator.";
  if (request.mode === "generate") {
    const result = generateHeuristicScene(request.prompt, request.audioProfile ?? null);
    return { mode: "generate", source: "heuristic", summary: result.summary, warnings: [note, ...result.warnings].slice(0, 100), scene: result.scene };
  }
  const scene = request.scene!;
  const result = refineHeuristicScene(request.prompt, scene, request.selectedLayerId ?? null);
  const trial = applyScenePatch(scene, result.patch);
  return {
    mode: "refine",
    source: "heuristic",
    summary: result.summary,
    warnings: [note, ...result.warnings, ...trial.warnings].slice(0, 100),
    patch: result.patch,
  };
}

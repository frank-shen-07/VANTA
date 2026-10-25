/**
 * Scene generation orchestrator: LLM (when configured) → expand + sanitize →
 * heuristic fallback (with a warning) on refusal, truncation, errors or
 * unusable output. Refine results are test-applied to collect warnings; the
 * client applies the patch to its latest scene.
 */
import type { SceneGenerationRequest, SceneGenerationResponse } from "@/shared/ai/contract";
import { applyScenePatch } from "@/shared/scene/patch";
import { AI_TOTAL_BUDGET_MS } from "./config";
import { REFINE_DRAFT_JSON_SCHEMA, SCENE_DRAFT_JSON_SCHEMA, expandRefineDraft, expandSceneDraft } from "./draft";
import { generateHeuristicScene, refineHeuristicScene } from "./heuristic";
import type { LLMFailure, SceneLLM } from "./llm";
import { SYSTEM_PROMPT, generateUserMessage, refineUserMessage } from "./prompt";

const FAILURE_TEXT: Record<LLMFailure | "unusable", string> = {
  refusal: "the AI model declined the request",
  truncated: "the AI response was cut off",
  empty: "the AI returned no result",
  invalid_json: "the AI returned malformed data",
  rate_limited: "the AI service is rate limited",
  auth: "the AI credentials were rejected",
  timeout: "the AI service timed out",
  connection: "the AI service could not be reached",
  bad_request: "the AI service rejected the request",
  upstream: "the AI service returned an error",
  aborted: "the request was cancelled",
  unusable: "the AI result contained no usable layers",
};

export interface GenerationDeps {
  llm: SceneLLM | null;
  signal?: AbortSignal;
}

function heuristicResponse(request: SceneGenerationRequest, note: string): SceneGenerationResponse {
  if (request.mode === "generate") {
    const result = generateHeuristicScene(request.prompt, request.audioProfile ?? null);
    return { mode: "generate", source: "heuristic", summary: result.summary, warnings: [note, ...result.warnings].slice(0, 100), scene: result.scene };
  }
  const scene = request.scene!;
  const result = refineHeuristicScene(request.prompt, scene, request.selectedLayerId ?? null);
  const trial = applyScenePatch(scene, result.patch);
  return { mode: "refine", source: "heuristic", summary: result.summary, warnings: [note, ...result.warnings, ...trial.warnings].slice(0, 100), patch: result.patch };
}

export async function runSceneGeneration(request: SceneGenerationRequest, deps: GenerationDeps): Promise<SceneGenerationResponse> {
  const { llm } = deps;
  if (!llm) return heuristicResponse(request, "No AI model configured; used the built-in keyword generator.");
  const signal = deps.signal ? AbortSignal.any([deps.signal, AbortSignal.timeout(AI_TOTAL_BUDGET_MS)]) : AbortSignal.timeout(AI_TOTAL_BUDGET_MS);
  let failure: LLMFailure | "unusable";
  try {
    if (request.mode === "generate") {
      const outcome = await llm.requestJson({ system: SYSTEM_PROMPT, user: generateUserMessage(request.prompt, request.audioProfile), schema: SCENE_DRAFT_JSON_SCHEMA, signal });
      if (outcome.ok) {
        const expanded = expandSceneDraft(outcome.data, request.prompt);
        if (expanded) {
          return {
            mode: "generate",
            source: "llm",
            model: outcome.model,
            summary: expanded.summary || `Created “${expanded.scene.name}”.`,
            warnings: expanded.warnings.slice(0, 100),
            scene: expanded.scene,
          };
        }
        failure = "unusable";
      } else failure = outcome.reason;
    } else {
      const scene = request.scene!;
      const outcome = await llm.requestJson({ system: SYSTEM_PROMPT, user: refineUserMessage(request.prompt, scene, request.selectedLayerId, request.audioProfile), schema: REFINE_DRAFT_JSON_SCHEMA, signal });
      if (outcome.ok) {
        const expanded = expandRefineDraft(outcome.data, scene);
        if (expanded) {
          const trial = applyScenePatch(scene, expanded.patch);
          return {
            mode: "refine",
            source: "llm",
            model: outcome.model,
            summary: expanded.summary || (expanded.patch.ops.length ? "Updated the scene." : "No changes were needed."),
            warnings: [...expanded.warnings, ...trial.warnings].slice(0, 100),
            patch: expanded.patch,
          };
        }
        failure = "unusable";
      } else failure = outcome.reason;
    }
  } catch (e) {
    console.error("[ai] unexpected LLM failure", e);
    failure = "upstream";
  }
  return heuristicResponse(request, `Used the built-in generator because ${FAILURE_TEXT[failure]}.`);
}

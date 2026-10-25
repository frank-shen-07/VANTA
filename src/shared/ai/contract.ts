/**
 * AI SCENE API CONTRACT — owned by the lead orchestrator, implemented by Agent 3.
 *
 * POST /api/scene  (JSON body: SceneGenerationRequest)
 *   200 → SceneGenerationResponse
 *   4xx/5xx → SceneApiError
 * GET /api/scene → SceneApiStatus (whether an LLM is configured)
 *
 * The model may only choose from the layer types / fields / bounds defined in
 * src/shared/scene/schema.ts. All model output is passed through
 * sanitizeSceneConfig / applyScenePatch before it reaches the store.
 * No code (JS, JSX, GLSL) is ever generated or executed.
 */
import { z } from "zod";
import { AudioProfileSchema } from "@/shared/audio/contract";
import { ScenePatchSchema } from "@/shared/scene/patch";
import { IdSchema, LIMITS, SceneConfigSchema } from "@/shared/scene/schema";

export const SceneGenerationModeSchema = z.enum(["generate", "refine"]);
export type SceneGenerationMode = z.infer<typeof SceneGenerationModeSchema>;

export const SceneGenerationRequestSchema = z
  .object({
    /** generate = new scene from scratch; refine = targeted edits to `scene`. */
    mode: SceneGenerationModeSchema,
    prompt: z.string().trim().min(1).max(LIMITS.maxPromptLength),
    /** Current scene (required for refine; optional context for generate). */
    scene: SceneConfigSchema.optional(),
    /** Layer the user has selected, so "make this bigger" can be resolved. */
    selectedLayerId: IdSchema.nullable().optional(),
    /** Characteristics of the current music, when real analysis is available. */
    audioProfile: AudioProfileSchema.nullable().optional(),
  })
  .refine((r) => r.mode === "generate" || r.scene !== undefined, { message: "refine requires the current scene", path: ["scene"] });
export type SceneGenerationRequest = z.infer<typeof SceneGenerationRequestSchema>;

export const SceneGenerationSourceSchema = z.enum(["llm", "heuristic"]);
export type SceneGenerationSource = z.infer<typeof SceneGenerationSourceSchema>;

export const SceneGenerationResponseSchema = z.object({
  mode: SceneGenerationModeSchema,
  /** "heuristic" = local keyword-based generator (no API key or LLM failure). */
  source: SceneGenerationSourceSchema,
  model: z.string().optional(),
  /** One or two sentences describing what was created/changed. */
  summary: z.string().max(600),
  warnings: z.array(z.string()).max(100),
  /** Present for mode=generate: a complete, sanitized scene. */
  scene: SceneConfigSchema.optional(),
  /** Present for mode=refine: targeted ops to apply to the latest scene. */
  patch: ScenePatchSchema.optional(),
});
export type SceneGenerationResponse = z.infer<typeof SceneGenerationResponseSchema>;

export const SceneApiErrorCodeSchema = z.enum(["invalid_request", "rate_limited", "upstream_error", "validation_failed", "internal"]);
export const SceneApiErrorSchema = z.object({
  error: z.object({
    code: SceneApiErrorCodeSchema,
    message: z.string(),
    retryAfterSec: z.number().optional(),
  }),
});
export type SceneApiError = z.infer<typeof SceneApiErrorSchema>;

export const SceneApiStatusSchema = z.object({
  llmConfigured: z.boolean(),
  model: z.string().nullable(),
  fallback: z.literal("heuristic"),
});
export type SceneApiStatus = z.infer<typeof SceneApiStatusSchema>;

/** Style suggestion derived from the current music (no claims of emotion recognition). */
export interface StyleSuggestion {
  id: string;
  label: string;
  prompt: string;
  /** Why it was suggested, e.g. "Bass-heavy, ~128 BPM". */
  reason: string;
}

"use client";

/**
 * STUB — Agent 3 (Backend, AI & Scene Intelligence) replaces this implementation.
 * Contract: the only client entry point for AI scene generation/refinement.
 * The UI (Agent 1's prompt bar) calls generate()/refine(); the hook calls
 * POST /api/scene, then applies the result to useSceneStore (setScene for
 * generate, applyPatch for refine) so manual edits are preserved.
 */
import type { SceneGenerationSource, StyleSuggestion } from "@/shared/ai/contract";

export type SceneAIStatus = "idle" | "pending" | "success" | "error";

export interface SceneAIResult {
  summary: string;
  source: SceneGenerationSource;
  warnings: string[];
}

export interface UseSceneAI {
  status: SceneAIStatus;
  error: string | null;
  lastResult: SceneAIResult | null;
  /** Whether the server has an LLM configured (null until known). */
  llmConfigured: boolean | null;
  /** Create a brand-new scene from the prompt (explicit full regeneration). */
  generate(prompt: string): Promise<void>;
  /** Apply targeted changes to the current scene. */
  refine(prompt: string): Promise<void>;
  cancel(): void;
  /** Prompt ideas derived from the current music (empty when no analysis is available). */
  suggestions: StyleSuggestion[];
}

export function useSceneAI(): UseSceneAI {
  return {
    status: "idle",
    error: null,
    lastResult: null,
    llmConfigured: null,
    generate: async () => {},
    refine: async () => {},
    cancel: () => {},
    suggestions: [],
  };
}

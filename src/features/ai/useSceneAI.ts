"use client";

/**
 * Client entry point for AI scene generation/refinement (Agent 3).
 * generate() → POST /api/scene → useSceneStore.setScene; refine() → applyPatch
 * on the LATEST store state so manual edits made meanwhile are preserved.
 * State lives in a small zustand store so several components can read it.
 */
import { useEffect } from "react";
import { create } from "zustand";
import {
  SceneApiErrorSchema,
  SceneApiStatusSchema,
  SceneGenerationResponseSchema,
  type SceneGenerationMode,
  type SceneGenerationSource,
  type StyleSuggestion,
} from "@/shared/ai/contract";
import { AudioProfileSchema } from "@/shared/audio/contract";
import { getAudioController } from "@/shared/runtime/registry";
import { LIMITS } from "@/shared/scene/schema";
import { useSceneStore } from "@/store/sceneStore";

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

interface AIState {
  status: SceneAIStatus;
  error: string | null;
  lastResult: SceneAIResult | null;
  llmConfigured: boolean | null;
}

export const useSceneAIStore = create<AIState>()(() => ({ status: "idle", error: null, lastResult: null, llmConfigured: null }));

let inflight: AbortController | null = null;
let statusRequested = false;
const NO_SUGGESTIONS: StyleSuggestion[] = [];

const FRIENDLY: Record<string, string> = {
  rate_limited: "You're sending prompts quickly — please wait a moment and try again.",
  upstream_error: "The AI service is unavailable right now. Please try again.",
  validation_failed: "The generated scene didn't pass validation. Try rephrasing your prompt.",
  internal: "Something went wrong on the server. Please try again.",
};

function friendlyError(status: number, body: unknown): string {
  const parsed = SceneApiErrorSchema.safeParse(body);
  if (!parsed.success) return `The server returned an unexpected response (HTTP ${status}).`;
  const { code, message, retryAfterSec } = parsed.data.error;
  if (code === "rate_limited" && retryAfterSec) return `You're sending prompts quickly — try again in ${retryAfterSec}s.`;
  if (code === "invalid_request") return `That request couldn't be processed: ${message}`;
  return FRIENDLY[code] ?? message;
}

function loadStatus(): void {
  if (statusRequested) return;
  statusRequested = true;
  fetch("/api/scene", { method: "GET", cache: "no-store" })
    .then((res) => res.json())
    .then((body) => {
      const parsed = SceneApiStatusSchema.safeParse(body);
      useSceneAIStore.setState({ llmConfigured: parsed.success ? parsed.data.llmConfigured : false });
    })
    .catch(() => {
      statusRequested = false;
    });
}

function currentAudioProfile() {
  try {
    const profile = getAudioController()?.getAudioProfile() ?? null;
    const parsed = AudioProfileSchema.nullable().safeParse(profile);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function run(mode: SceneGenerationMode, prompt: string): Promise<void> {
  const text = prompt.trim().slice(0, LIMITS.maxPromptLength);
  if (!text) {
    useSceneAIStore.setState({ status: "error", error: "Type a prompt first." });
    return;
  }
  inflight?.abort();
  const controller = new AbortController();
  inflight = controller;
  useSceneAIStore.setState({ status: "pending", error: null });
  const { scene, selectedLayerId } = useSceneStore.getState();
  try {
    const res = await fetch("/api/scene", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode, prompt: text, scene, selectedLayerId, audioProfile: currentAudioProfile() }),
      signal: controller.signal,
    });
    const body: unknown = await res.json().catch(() => null);
    if (inflight !== controller) return;
    if (!res.ok) {
      useSceneAIStore.setState({ status: "error", error: friendlyError(res.status, body) });
      return;
    }
    const parsed = SceneGenerationResponseSchema.safeParse(body);
    if (!parsed.success) {
      useSceneAIStore.setState({ status: "error", error: "The server returned an invalid scene." });
      return;
    }
    const data = parsed.data;
    const warnings = [...data.warnings];
    if (mode === "generate") {
      if (!data.scene) throw new Error("missing scene");
      const applied = useSceneStore.getState().setScene(data.scene, { source: "ai" });
      if (!applied.ok) {
        useSceneAIStore.setState({ status: "error", error: "The generated scene could not be loaded." });
        return;
      }
      warnings.push(...applied.warnings);
    } else {
      const result = useSceneStore.getState().applyPatch(data.patch ?? { ops: [] }, "ai");
      warnings.push(...result.warnings);
    }
    useSceneAIStore.setState({ status: "success", error: null, lastResult: { summary: data.summary, source: data.source, warnings: warnings.slice(0, 100) } });
  } catch (e) {
    if (controller.signal.aborted) {
      if (inflight === controller) useSceneAIStore.setState({ status: "idle" });
      return;
    }
    void e;
    useSceneAIStore.setState({ status: "error", error: "Couldn't reach the VANTA server. Check your connection and try again." });
  } finally {
    if (inflight === controller) inflight = null;
  }
}

const generate = (prompt: string) => run("generate", prompt);
const refine = (prompt: string) => run("refine", prompt);
function cancel(): void {
  if (!inflight) return;
  inflight.abort();
  inflight = null;
  useSceneAIStore.setState({ status: "idle" });
}

export function useSceneAI(): UseSceneAI {
  const status = useSceneAIStore((s) => s.status);
  const error = useSceneAIStore((s) => s.error);
  const lastResult = useSceneAIStore((s) => s.lastResult);
  const llmConfigured = useSceneAIStore((s) => s.llmConfigured);
  useEffect(() => {
    loadStatus();
  }, []);
  // TODO(agent3): audio-derived style suggestions (suggest.ts) not implemented yet.
  return { status, error, lastResult, llmConfigured, generate, refine, cancel, suggestions: NO_SUGGESTIONS };
}

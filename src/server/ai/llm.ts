/**
 * Anthropic client wrapper (server-only). Structured outputs constrain the
 * response to the draft JSON schema; server-side refusal fallbacks
 * (`fallbacks: "default"`, beta server-side-fallback-2026-07-01) are enabled
 * unless VANTA_AI_FALLBACKS=0. Thinking is left at the model default (always
 * on for claude-opus-5-5); latency is controlled with output_config.effort.
 * No temperature/top_p/top_k, no prefill, no forced tool_choice.
 * `createMessage` is injectable so tests never call the real API.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessage, MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { AI_MAX_RETRIES, AI_REQUEST_TIMEOUT_MS, readAIConfig, type AIConfig, type AIEffort } from "./config";

export type CreateMessage = (params: MessageCreateParamsNonStreaming, options: { signal?: AbortSignal }) => Promise<BetaMessage>;

export type LLMFailure = "refusal" | "truncated" | "empty" | "invalid_json" | "rate_limited" | "auth" | "timeout" | "connection" | "bad_request" | "upstream" | "aborted";
export type LLMOutcome = { ok: true; data: unknown; model: string } | { ok: false; reason: LLMFailure; detail: string };

export interface SceneLLM {
  readonly model: string;
  requestJson(input: { system: string; user: string; schema: Record<string, unknown>; effort?: AIEffort; signal?: AbortSignal }): Promise<LLMOutcome>;
}

const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export function createSceneLLM(config: AIConfig, createMessage?: CreateMessage): SceneLLM {
  let create = createMessage;
  if (!create) {
    const client = new Anthropic({ ...(config.credentials ?? {}), timeout: AI_REQUEST_TIMEOUT_MS, maxRetries: AI_MAX_RETRIES });
    create = (params, options) => client.beta.messages.create(params, options);
  }
  let useFallbacks = config.fallbacks;

  return {
    model: config.model,
    async requestJson({ system, user, schema, effort, signal }) {
      const params = (withFallbacks: boolean): MessageCreateParamsNonStreaming => ({
        model: config.model,
        max_tokens: 16000,
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: user }],
        output_config: { effort: effort ?? config.effort, format: { type: "json_schema", schema } },
        ...(withFallbacks ? { fallbacks: "default" as const, betas: [FALLBACK_BETA] } : {}),
      });
      let message: BetaMessage;
      try {
        try {
          message = await create(params(useFallbacks), { signal });
        } catch (e) {
          // The fallback beta may be unavailable for this account: retry once without it and remember.
          if (!(useFallbacks && e instanceof Anthropic.BadRequestError)) throw e;
          message = await create(params(false), { signal });
          useFallbacks = false;
        }
      } catch (e) {
        if (e instanceof Anthropic.APIUserAbortError) return { ok: false, reason: "aborted", detail: "request aborted" };
        if (e instanceof Anthropic.RateLimitError) return { ok: false, reason: "rate_limited", detail: "rate limited" };
        if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return { ok: false, reason: "auth", detail: "authentication failed" };
        if (e instanceof Anthropic.APIConnectionTimeoutError) return { ok: false, reason: "timeout", detail: "timed out" };
        if (e instanceof Anthropic.APIConnectionError) return { ok: false, reason: "connection", detail: "connection failed" };
        if (e instanceof Anthropic.BadRequestError) return { ok: false, reason: "bad_request", detail: "request rejected" };
        if (e instanceof Anthropic.APIError) return { ok: false, reason: "upstream", detail: `API error ${e.status ?? ""}`.trim() };
        throw e;
      }
      if (message.stop_reason === "refusal") return { ok: false, reason: "refusal", detail: "the model declined" };
      if (message.stop_reason === "max_tokens") return { ok: false, reason: "truncated", detail: "output was cut off" };
      const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
      if (!text.trim()) return { ok: false, reason: "empty", detail: "no output" };
      try {
        return { ok: true, data: JSON.parse(text) as unknown, model: message.model };
      } catch {
        return { ok: false, reason: "invalid_json", detail: "output was not JSON" };
      }
    },
  };
}

let shared: { key: string; llm: SceneLLM } | null = null;

/** Process-wide client when a key is configured, else null. */
export function getConfiguredSceneLLM(): SceneLLM | null {
  const config = readAIConfig();
  if (!config.configured) return null;
  const key = `${config.model}|${config.effort}|${config.fallbacks}|${JSON.stringify(config.credentials)}`;
  if (!shared || shared.key !== key) shared = { key, llm: createSceneLLM(config) };
  return shared.llm;
}

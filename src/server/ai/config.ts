/**
 * Server-only AI configuration. Secrets are read from the environment at
 * request time and never leave the server (no NEXT_PUBLIC_ variables).
 */

export type AIEffort = "low" | "medium" | "high";

export const DEFAULT_AI_MODEL = "claude-opus-5-5";
export const DEFAULT_AI_EFFORT: AIEffort = "low";
/** Per-attempt timeout for the Anthropic API (milliseconds). */
export const AI_REQUEST_TIMEOUT_MS = 50_000;
export const AI_MAX_RETRIES = 1;
/** Hard ceiling for one /api/scene request, including the retry. */
export const AI_TOTAL_BUDGET_MS = 110_000;

export interface AIConfig {
  /** True when ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN is set. */
  configured: boolean;
  model: string;
  effort: AIEffort;
  /** Opt-in server-side refusal fallbacks (beta). Disable with VANTA_AI_FALLBACKS=0. */
  fallbacks: boolean;
  credentials: { apiKey: string } | { authToken: string } | null;
}

type Env = Record<string, string | undefined>;

const clean = (v: string | undefined) => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);

export function readAIConfig(env: Env = process.env): AIConfig {
  const apiKey = clean(env.ANTHROPIC_API_KEY);
  const authToken = clean(env.ANTHROPIC_AUTH_TOKEN);
  const model = clean(env.VANTA_AI_MODEL);
  const effortRaw = clean(env.VANTA_AI_EFFORT)?.toLowerCase();
  const effort: AIEffort = effortRaw === "low" || effortRaw === "medium" || effortRaw === "high" ? effortRaw : DEFAULT_AI_EFFORT;
  const fallbacksRaw = clean(env.VANTA_AI_FALLBACKS)?.toLowerCase();
  return {
    configured: Boolean(apiKey || authToken),
    // Model ids are short tokens; anything else is ignored rather than sent upstream.
    model: model && /^[A-Za-z0-9._:@/-]{1,100}$/.test(model) ? model : DEFAULT_AI_MODEL,
    effort,
    fallbacks: !(fallbacksRaw === "0" || fallbacksRaw === "false" || fallbacksRaw === "off"),
    credentials: apiKey ? { apiKey } : authToken ? { authToken } : null,
  };
}

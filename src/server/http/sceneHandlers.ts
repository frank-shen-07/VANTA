/** HTTP logic for /api/scene, kept out of the route file so it is unit-testable. */
import { SceneGenerationRequestSchema, SceneGenerationResponseSchema, type SceneApiError, type SceneApiStatus } from "@/shared/ai/contract";
import { readAIConfig } from "@/server/ai/config";
import { runSceneGeneration } from "@/server/ai/generate";

export const MAX_BODY_BYTES = 256 * 1024;
const RATE_LIMIT = 12;
const RATE_WINDOW_MS = 60_000;
const hits = new Map<string, number[]>();

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

function error(code: SceneApiError["error"]["code"], message: string, status: number, retryAfterSec?: number): Response {
  const body: SceneApiError = { error: { code, message, ...(retryAfterSec !== undefined ? { retryAfterSec } : {}) } };
  return json(body, status, retryAfterSec !== undefined ? { "Retry-After": String(retryAfterSec) } : {});
}

export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (forwarded || request.headers.get("x-real-ip")?.trim() || "anonymous").slice(0, 100);
}

/** Sliding-window limiter; returns seconds to wait, or 0 when allowed. */
export function checkRateLimit(key: string, now = Date.now()): number {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) {
    hits.set(key, recent);
    return Math.max(1, Math.ceil((recent[0] + RATE_WINDOW_MS - now) / 1000));
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) hits.delete(hits.keys().next().value as string);
  return 0;
}

async function readBody(request: Request): Promise<{ ok: true; text: string } | { ok: false }> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return { ok: false };
  if (!request.body) return { ok: true, text: "" };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => {});
      return { ok: false };
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    all.set(c, offset);
    offset += c.byteLength;
  }
  return { ok: true, text: new TextDecoder().decode(all) };
}

export function handleStatus(): Response {
  const config = readAIConfig();
  const body: SceneApiStatus = { llmConfigured: config.configured, model: config.configured ? config.model : null, fallback: "heuristic" };
  return json(body);
}

export async function handleGenerate(request: Request): Promise<Response> {
  try {
    const wait = checkRateLimit(clientKey(request));
    if (wait > 0) return error("rate_limited", `Too many requests. Try again in ${wait}s.`, 429, wait);
    const body = await readBody(request);
    if (!body.ok) return error("invalid_request", `Request body exceeds ${MAX_BODY_BYTES / 1024} KB.`, 413);
    let data: unknown;
    try {
      data = JSON.parse(body.text);
    } catch {
      return error("invalid_request", "Request body is not valid JSON.", 400);
    }
    const parsed = SceneGenerationRequestSchema.safeParse(data);
    if (!parsed.success) {
      const message = parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join(".") || "body"}: ${i.message}`)
        .join("; ");
      return error("invalid_request", message.slice(0, 300), 400);
    }
    const response = runSceneGeneration(parsed.data);
    const checked = SceneGenerationResponseSchema.safeParse(response);
    if (!checked.success) return error("validation_failed", "The generated result failed validation.", 500);
    return json(checked.data);
  } catch (e) {
    console.error("[api/scene] unexpected error", e);
    return error("internal", "Something went wrong while generating the scene.", 500);
  }
}

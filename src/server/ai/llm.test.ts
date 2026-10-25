import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessage, MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { describe, expect, it } from "vitest";
import { applyScenePatch } from "@/shared/scene/patch";
import { createPresetScene } from "@/shared/scene/presets";
import { SceneConfigSchema } from "@/shared/scene/schema";
import { readAIConfig } from "./config";
import { runSceneGeneration } from "./generate";
import { createSceneLLM, type CreateMessage } from "./llm";

const config = readAIConfig({ ANTHROPIC_API_KEY: "test-key" });

function message(text: string, stop_reason: BetaMessage["stop_reason"] = "end_turn"): BetaMessage {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content: text ? [{ type: "text", text, citations: null }] : [],
    stop_reason,
    stop_details: null,
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
    container: null,
    context_management: null,
    diagnostics: null,
  } as unknown as BetaMessage;
}

function mockClient(responses: (BetaMessage | Error)[]) {
  const calls: MessageCreateParamsNonStreaming[] = [];
  const create: CreateMessage = async (params) => {
    calls.push(params);
    const next = responses[Math.min(calls.length - 1, responses.length - 1)];
    if (next instanceof Error) throw next;
    return next;
  };
  return { llm: createSceneLLM(config, create), calls };
}

const PROMPT = "red cyberpunk tunnel with neon rings";
const DRAFT = {
  name: "Crimson Run",
  summary: "A red tunnel with pulsing rings.",
  preset: "neon-tunnel",
  settings: [
    { path: "post.bloom.intensity", value: "2.2" },
    { path: "environment.fog.density", value: "9" },
    { path: "audio.sensitivity", value: "1.4" },
  ],
  layers: [
    {
      type: "tunnel",
      name: "Red Tunnel",
      settings: [
        { path: "tunnel.colorA", value: "#ff1f3d" },
        { path: "tunnel.sides", value: "999" },
        { path: "glow", value: "alert(1)" },
        { path: "tunnel.colorB", value: "<script>x</script>" },
      ],
      reactivity: [{ source: "bass", target: "brightness", amount: 9, threshold: 0, smoothing: 0.2 }],
    },
    { type: "hologram", name: "Bad", settings: [], reactivity: [] },
    {
      type: "rings",
      name: "Pulse <b>Rings</b>",
      settings: [{ path: "rings.count", value: "20" }],
      reactivity: [
        { source: "bass", target: "scale", amount: 0.6, threshold: 0.1, smoothing: 0.2 },
        { source: "bass", target: "explode", amount: 1, threshold: 0, smoothing: 0 },
      ],
    },
  ],
};

describe("LLM scene generation (mocked client)", () => {
  it("sends a valid request and expands + sanitizes the draft", async () => {
    const { llm, calls } = mockClient([message(JSON.stringify(DRAFT))]);
    const res = await runSceneGeneration({ mode: "generate", prompt: PROMPT }, { llm });
    expect(res.source).toBe("llm");
    expect(SceneConfigSchema.safeParse(res.scene).success).toBe(true);
    const scene = res.scene!;
    expect(scene.layers.map((l) => l.type)).toEqual(["tunnel", "rings"]);
    const tunnel = scene.layers[0];
    if (tunnel.type !== "tunnel") throw new Error("type");
    expect(tunnel.tunnel.colorA).toBe("#ff1f3d");
    expect(tunnel.tunnel.sides).toBe(48);
    expect(tunnel.glow).toBe(1.5);
    expect(tunnel.reactivity[0].amount).toBe(3);
    expect(scene.layers[1].name).not.toMatch(/[<>]/);
    expect(scene.layers[1].reactivity).toHaveLength(1);
    expect(scene.environment.fog.density).toBe(0.15);
    expect(scene.meta.origin).toBe("ai");
    expect(res.warnings.join(" ")).toMatch(/hologram/);

    const params = calls[0] as unknown as Record<string, unknown>;
    expect(params.model).toBe("claude-opus-5-5");
    expect(params).not.toHaveProperty("temperature");
    expect(params).not.toHaveProperty("thinking");
    expect(params.output_config).toMatchObject({ effort: "low", format: { type: "json_schema" } });
    expect(params.fallbacks).toBe("default");
  });

  it.each([
    ["refusal", message("", "refusal")],
    ["max_tokens", message('{"name": "cut', "max_tokens")],
    ["malformed JSON", message("not json at all")],
    ["no usable layers", message(JSON.stringify({ ...DRAFT, layers: [{ type: "hologram", name: "x", settings: [], reactivity: [] }] }))],
    ["connection error", new Anthropic.APIConnectionError({ message: "down" })],
    ["rate limit", new Anthropic.RateLimitError(429, undefined, "slow down", new Headers())],
  ])("falls back to the heuristic on %s", async (_label, response) => {
    const { llm } = mockClient([response]);
    const res = await runSceneGeneration({ mode: "generate", prompt: PROMPT }, { llm });
    expect(res.source).toBe("heuristic");
    expect(res.warnings[0]).toMatch(/built-in generator/);
    expect(SceneConfigSchema.safeParse(res.scene).success).toBe(true);
  });

  it("retries without the fallback beta when it is rejected", async () => {
    const { llm, calls } = mockClient([new Anthropic.BadRequestError(400, undefined, "unknown beta", new Headers()), message(JSON.stringify(DRAFT))]);
    const res = await runSceneGeneration({ mode: "generate", prompt: PROMPT }, { llm });
    expect(res.source).toBe("llm");
    expect(calls).toHaveLength(2);
    expect(calls[1]).not.toHaveProperty("fallbacks");
  });

  it("refine returns targeted ops for the named layer only", async () => {
    const scene = createPresetScene("neon-tunnel");
    const rings = scene.layers.find((l) => l.type === "rings")!;
    const draft = {
      summary: "Made the rings bigger.",
      ops: [
        { op: "updateLayer", layerId: rings.id, layerType: "none", name: "", settings: [{ path: "transform.scale", value: "1.6" }], replaceReactivity: false, reactivity: [] },
        { op: "updateLayer", layerId: "lyr_missing", layerType: "none", name: "", settings: [], replaceReactivity: false, reactivity: [] },
      ],
    };
    const { llm } = mockClient([message(JSON.stringify(draft))]);
    const res = await runSceneGeneration({ mode: "refine", prompt: "bigger rings", scene, selectedLayerId: null }, { llm });
    expect(res.source).toBe("llm");
    expect(res.patch!.ops).toEqual([{ op: "updateLayer", layerId: rings.id, changes: { transform: { scale: 1.6 } } }]);
    const applied = applyScenePatch(scene, res.patch!);
    for (const layer of scene.layers.filter((l) => l.id !== rings.id)) expect(applied.scene.layers.find((l) => l.id === layer.id)).toEqual(layer);
  });
});

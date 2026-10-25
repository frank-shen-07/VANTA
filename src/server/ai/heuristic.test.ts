import { describe, expect, it, vi } from "vitest";
import { applyScenePatch } from "@/shared/scene/patch";
import { createPresetScene } from "@/shared/scene/presets";
import { SceneConfigSchema } from "@/shared/scene/schema";
import { hexToRgb } from "./palette";
import { generateHeuristicScene, refineHeuristicScene } from "./heuristic";

vi.mock("next/server", () => ({ connection: async () => {} }));

const PROMPTS = [
  "Create a futuristic red cyberpunk tunnel with pulsing neon rings and glowing particles that react strongly to bass.",
  "calm ambient galaxy of soft stars",
  "aggressive techno grid with a spinning crystal",
  "ocean waves underwater shimmering with the hi-hats",
  "golden luxury torus knot, slow and cinematic",
  "retro synthwave sunset horizon",
  "spectrum bars equalizer hip-hop",
  "ice crystals frozen arctic",
  "fire inferno lava orbs exploding on the kick",
  "monochrome noir minimal",
  "toxic acid green rave lasers",
  "forest fireflies gentle",
  "",
  "!!!",
  "a b c d e f g ".repeat(40),
  "purple and orange wormhole with hexagonal rings and a twisting tunnel, very fast",
];

describe("heuristic generator", () => {
  it.each(PROMPTS)("produces a valid scene for %j", (prompt) => {
    const { scene, summary } = generateHeuristicScene(prompt || "x");
    expect(SceneConfigSchema.safeParse(scene).success).toBe(true);
    expect(scene.layers.length).toBeGreaterThanOrEqual(2);
    expect(scene.layers.length).toBeLessThanOrEqual(5);
    expect(scene.meta.origin).toBe("heuristic");
    expect(summary.length).toBeGreaterThan(0);
  });

  it("handles the cyberpunk example", () => {
    const { scene } = generateHeuristicScene(PROMPTS[0]);
    const types = scene.layers.map((l) => l.type);
    expect(types).toEqual(expect.arrayContaining(["tunnel", "rings", "particles"]));
    const tunnel = scene.layers.find((l) => l.type === "tunnel");
    if (tunnel?.type !== "tunnel") throw new Error("no tunnel");
    const [r, g] = hexToRgb(tunnel.tunnel.colorA);
    expect(r).toBeGreaterThan(200);
    expect(g).toBeLessThan(100);
    for (const layer of scene.layers) {
      expect(layer.reactivity.some((m) => m.enabled && m.source === "bass" && m.amount >= 0.6)).toBe(true);
    }
    expect(scene.audio.sensitivity).toBeGreaterThanOrEqual(1.2);
  });

  it("refine produces targeted patches and leaves other layers untouched", () => {
    const scene = createPresetScene("neon-tunnel");
    const rings = scene.layers.find((l) => l.type === "rings")!;
    const { patch } = refineHeuristicScene("make the rings bigger and more red", scene, null);
    expect(patch.ops.length).toBeGreaterThan(0);
    for (const op of patch.ops) if (op.op === "updateLayer") expect(op.layerId).toBe(rings.id);
    const result = applyScenePatch(scene, patch);
    const after = result.scene.layers.find((l) => l.id === rings.id)!;
    expect(after.transform.scale).toBeGreaterThan(rings.transform.scale);
    for (const layer of scene.layers.filter((l) => l.id !== rings.id)) {
      expect(result.scene.layers.find((l) => l.id === layer.id)).toEqual(layer);
    }
  });

  it("refine add/remove and unknown requests", () => {
    const scene = createPresetScene("neon-tunnel");
    expect(refineHeuristicScene("add a grid", scene).patch.ops.some((o) => o.op === "addLayer")).toBe(true);
    expect(refineHeuristicScene("remove the tunnel", scene).patch.ops.some((o) => o.op === "removeLayer")).toBe(true);
    expect(refineHeuristicScene("qwerty zxcv", scene).patch.ops).toEqual([]);
  });
});

describe("/api/scene route", () => {
  const post = async (body: string, ip: string, headers: Record<string, string> = {}) => {
    const { POST } = await import("@/app/api/scene/route");
    return POST(new Request("http://x/api/scene", { method: "POST", body, headers: { "content-type": "application/json", "x-forwarded-for": ip, ...headers } }));
  };

  it("GET reports status without a key", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "");
    const { GET } = await import("@/app/api/scene/route");
    const res = await GET();
    expect(await res.json()).toEqual({ llmConfigured: false, model: null, fallback: "heuristic" });
    vi.unstubAllEnvs();
  });

  it("generates and refines with the heuristic, rejects bad input, rate limits", async () => {
    const gen = await post(JSON.stringify({ mode: "generate", prompt: PROMPTS[0] }), "1.1.1.1");
    expect(gen.status).toBe(200);
    const genBody = await gen.json();
    expect(genBody.source).toBe("heuristic");
    expect(SceneConfigSchema.safeParse(genBody.scene).success).toBe(true);

    const ref = await post(JSON.stringify({ mode: "refine", prompt: "more glow", scene: genBody.scene }), "1.1.1.2");
    expect(ref.status).toBe(200);
    expect((await ref.json()).patch.ops.length).toBeGreaterThan(0);

    expect((await post("{not json", "1.1.1.3")).status).toBe(400);
    expect((await post(JSON.stringify({ mode: "refine", prompt: "x" }), "1.1.1.3")).status).toBe(400);
    expect((await post("x".repeat(300 * 1024), "1.1.1.4")).status).toBe(413);

    const codes: number[] = [];
    for (let i = 0; i < 13; i++) codes.push((await post(JSON.stringify({ mode: "generate", prompt: "calm" }), "9.9.9.9")).status);
    expect(codes.slice(0, 12).every((c) => c === 200)).toBe(true);
    expect(codes[12]).toBe(429);
  });
});

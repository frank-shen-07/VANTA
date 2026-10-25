import { describe, expect, it } from "vitest";
import { createSilentFeatures, type AudioFeatures } from "@/shared/audio/contract";
import { createGraphNode, createLayer, createMapping, createScene } from "@/shared/scene/defaults";
import type { SceneConfig } from "@/shared/scene/schema";
import { computeModulation, createModulationState, gate, getLayerModulation, smoothValue } from "./engine";

const features = (f: Partial<AudioFeatures>): AudioFeatures => ({ ...createSilentFeatures(), ...f });

function sceneWith(...layers: SceneConfig["layers"]): SceneConfig {
  return createScene({ layers });
}

describe("modulation engine", () => {
  it("maps bass to scale with amount and global sensitivity", () => {
    const layer = createLayer("shape", { reactivity: [createMapping({ source: "bass", target: "scale", amount: 0.5, smoothing: 0 })] });
    const scene = sceneWith(layer);
    scene.audio.sensitivity = 2;
    const state = computeModulation(scene, features({ bass: 0.8 }), 1 / 60, createModulationState());
    expect(getLayerModulation(state, layer.id).scale).toBeCloseTo(0.8);
    expect(getLayerModulation(state, layer.id).brightness).toBe(0);
  });

  it("silence produces zero modulation", () => {
    const layer = createLayer("particles");
    const state = computeModulation(sceneWith(layer), createSilentFeatures(), 1 / 60, createModulationState());
    const mod = getLayerModulation(state, layer.id);
    expect(Object.values(mod).every((v) => v === 0)).toBe(true);
  });

  it("disabled mappings are ignored and thresholds gate quiet input", () => {
    const layer = createLayer("rings", {
      reactivity: [
        createMapping({ source: "bass", target: "scale", amount: 1, enabled: false, smoothing: 0 }),
        createMapping({ source: "mids", target: "brightness", amount: 1, threshold: 0.5, smoothing: 0 }),
      ],
    });
    const state = computeModulation(sceneWith(layer), features({ bass: 1, mids: 0.4 }), 1 / 60, createModulationState());
    expect(getLayerModulation(state, layer.id).scale).toBe(0);
    expect(getLayerModulation(state, layer.id).brightness).toBe(0);
    expect(gate(0.75, 0.5)).toBeCloseTo(0.5);
  });

  it("smoothing approaches the target over time, frame-rate independently", () => {
    let v = 0;
    for (let i = 0; i < 60; i++) v = smoothValue(v, 1, 0.9, 1 / 60);
    let w = 0;
    for (let i = 0; i < 30; i++) w = smoothValue(w, 1, 0.9, 1 / 30);
    expect(v).toBeGreaterThan(0.99);
    expect(Math.abs(v - w)).toBeLessThan(1e-9);
  });

  it("evaluates the node graph: band → multiply → clamp → remap → visual parameter", () => {
    const layer = createLayer("particles", { reactivity: [] });
    const scene = sceneWith(layer);
    const band = createGraphNode("audioBand", { band: "highs" });
    const mul = createGraphNode("multiply", { factor: 4 });
    const clamp = createGraphNode("clamp", { min: 0, max: 1 });
    const remap = createGraphNode("remap", { inMin: 0, inMax: 1, outMin: 0, outMax: 2 });
    const sink = createGraphNode("visualParam", { layerId: layer.id, target: "size" });
    scene.graph = {
      enabled: true,
      nodes: [sink, remap, clamp, mul, band], // order should not matter
      edges: [
        { id: "e1", source: band.id, target: mul.id },
        { id: "e2", source: mul.id, target: clamp.id },
        { id: "e3", source: clamp.id, target: remap.id },
        { id: "e4", source: remap.id, target: sink.id },
      ],
    };
    const state = createModulationState();
    computeModulation(scene, features({ highs: 0.1 }), 1 / 60, state);
    expect(getLayerModulation(state, layer.id).size).toBeCloseTo(0.8); // 0.1*4=0.4 → clamp 0.4 → remap 0.8
    computeModulation(scene, features({ highs: 0.9 }), 1 / 60, state);
    expect(getLayerModulation(state, layer.id).size).toBeCloseTo(2); // 3.6 → clamp 1 → remap 2
    scene.graph = { ...scene.graph, enabled: false };
    computeModulation(scene, features({ highs: 0.9 }), 1 / 60, state);
    expect(getLayerModulation(state, layer.id).size).toBe(0);
  });

  it("ignores cycles without hanging", () => {
    const layer = createLayer("shape", { reactivity: [] });
    const scene = sceneWith(layer);
    const a = createGraphNode("smooth");
    const b = createGraphNode("multiply", { factor: 2 });
    const sink = createGraphNode("visualParam", { layerId: layer.id, target: "scale" });
    scene.graph = {
      enabled: true,
      nodes: [a, b, sink],
      edges: [
        { id: "e1", source: a.id, target: b.id },
        { id: "e2", source: b.id, target: a.id },
        { id: "e3", source: b.id, target: sink.id },
      ],
    };
    const state = computeModulation(scene, features({ bass: 1 }), 1 / 60, createModulationState());
    expect(getLayerModulation(state, layer.id).scale).toBe(0);
  });

  it("computes global camera shake and bloom multipliers", () => {
    const scene = sceneWith();
    scene.environment.camera.shake = 0.5;
    scene.post.bloom.audioBoost = 1;
    const state = computeModulation(scene, features({ onset: 1, energy: 0.5 }), 1 / 60, createModulationState());
    expect(state.global.cameraShake).toBeCloseTo(0.5);
    expect(state.global.bloomMultiplier).toBeCloseTo(1.5);
  });

  it("drops modulation entries for removed layers", () => {
    const a = createLayer("grid");
    const state = computeModulation(sceneWith(a), features({ bass: 1 }), 1 / 60, createModulationState());
    expect(state.layers.has(a.id)).toBe(true);
    computeModulation(sceneWith(), features({ bass: 1 }), 1 / 60, state);
    expect(state.layers.has(a.id)).toBe(false);
  });
});

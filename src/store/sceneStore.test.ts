import { beforeEach, describe, expect, it } from "vitest";
import { createPresetScene } from "@/shared/scene/presets";
import { SceneConfigSchema } from "@/shared/scene/schema";
import { useSceneStore } from "./sceneStore";

const store = () => useSceneStore.getState();

beforeEach(() => {
  store().setScene(createPresetScene("crystal-core"), { source: "preset", resetHistory: true });
});

describe("scene store", () => {
  it("starts with a valid scene and a selected layer", () => {
    expect(SceneConfigSchema.safeParse(store().scene).success).toBe(true);
    expect(store().selectedLayerId).toBe(store().scene.layers[0].id);
  });

  it("adds, selects, duplicates, moves and removes layers", () => {
    const id = store().addLayer("spectrum")!;
    expect(store().selectedLayerId).toBe(id);
    const copy = store().duplicateLayer(id)!;
    expect(store().scene.layers.map((l) => l.id)).toContain(copy);
    store().moveLayer(copy, 0);
    expect(store().scene.layers[0].id).toBe(copy);
    store().removeLayer(copy);
    expect(store().scene.layers.some((l) => l.id === copy)).toBe(false);
  });

  it("clamps inspector edits to schema bounds and ignores invalid values", () => {
    const layer = store().scene.layers[0];
    store().setLayerField(layer.id, "transform.scale", 999);
    expect(store().scene.layers[0].transform.scale).toBe(10);
    store().setLayerField(layer.id, "transform.position.1", 3.5);
    expect(store().scene.layers[0].transform.position[1]).toBe(3.5);
    store().setLayerField(layer.id, "shape.color", "not a colour");
    const after = store().scene.layers[0];
    if (after.type !== "shape" || layer.type !== "shape") throw new Error("type");
    expect(after.shape.color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("toggles visibility and renames", () => {
    const id = store().scene.layers[1].id;
    store().toggleLayerVisibility(id);
    expect(store().scene.layers[1].visible).toBe(false);
    store().renameLayer(id, "  Orbiters  ");
    expect(store().scene.layers[1].name).toBe("Orbiters");
  });

  it("undo / redo restores previous scenes; slider drags coalesce into one step", () => {
    const id = store().scene.layers[0].id;
    const original = store().scene.layers[0].opacity;
    store().setLayerField(id, "opacity", 0.9);
    store().setLayerField(id, "opacity", 0.5);
    store().setLayerField(id, "opacity", 0.3);
    expect(store().past).toHaveLength(1);
    store().undo();
    expect(store().scene.layers[0].opacity).toBe(original);
    store().redo();
    expect(store().scene.layers[0].opacity).toBe(0.3);
  });

  it("manages audio mappings with target validation", () => {
    const layer = store().scene.layers[0];
    const mapId = store().addMapping(layer.id, { source: "highs", target: "hue", amount: 1 })!;
    expect(mapId).toBeTruthy();
    store().updateMapping(layer.id, mapId, { amount: 50 });
    expect(store().scene.layers[0].reactivity.find((m) => m.id === mapId)!.amount).toBe(3);
    store().removeMapping(layer.id, mapId);
    expect(store().scene.layers[0].reactivity.some((m) => m.id === mapId)).toBe(false);
  });

  it("builds a node graph through store actions", () => {
    const layer = store().scene.layers[0];
    const band = store().addGraphNode("audioBand", { x: 0, y: 0 }, { band: "bass" })!;
    const sink = store().addGraphNode("visualParam", { x: 300, y: 0 }, { layerId: layer.id, target: "scale" })!;
    const edge = store().connectGraphNodes(band, sink)!;
    expect(store().scene.graph.edges.map((e) => e.id)).toEqual([edge]);
    store().updateGraphNode(sink, { target: "brightness" });
    expect(store().scene.graph.nodes.find((n) => n.id === sink)).toMatchObject({ target: "brightness" });
    store().removeGraphNodes([band]);
    expect(store().scene.graph.edges).toHaveLength(0);
  });

  it("applies AI patches to the latest scene", () => {
    const layer = store().scene.layers[0];
    store().setLayerField(layer.id, "opacity", 0.25); // manual edit
    const result = store().applyPatch({ ops: [{ op: "updatePost", changes: { vignette: 0.9 } }] });
    expect(result.applied).toBe(1);
    expect(store().scene.post.vignette).toBe(0.9);
    expect(store().scene.layers[0].opacity).toBe(0.25);
  });

  it("setScene sanitizes untrusted input", () => {
    const res = store().setScene({ layers: [{ type: "rings", rings: { count: 1000 } }, { type: "iframe" }] }, { source: "import" });
    expect(res.ok).toBe(true);
    expect(store().scene.layers).toHaveLength(1);
    expect(res.warnings.length).toBeGreaterThan(0);
  });

  it("updates environment / post / audio sections with clamping", () => {
    store().setSectionField("environment", "camera.fov", 10);
    expect(store().scene.environment.camera.fov).toBe(20);
    store().updateSection("audio", { sensitivity: 2.5 });
    expect(store().scene.audio.sensitivity).toBe(2.5);
  });
});

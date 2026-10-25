import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  COMMON_LAYER_FIELDS,
  LAYER_SCHEMAS,
  LAYER_TYPES,
  LAYER_TYPE_INFO,
  LayerSchema,
  PRESETS,
  SCENE_FIELDS,
  SceneConfigSchema,
  applyScenePatch,
  createFallbackScene,
  createLayer,
  createPresetScene,
  createScene,
  createSceneFile,
  fieldsForLayerType,
  parseSceneFile,
  sanitizeLayer,
  sanitizeSceneConfig,
  type Layer,
} from "@/shared/scene";
import { getAtPath, setAtPath } from "@/shared/utils/object";

describe("scene factories", () => {
  it.each(LAYER_TYPES)("createLayer(%s) is schema-valid", (type) => {
    expect(LayerSchema.safeParse(createLayer(type)).success).toBe(true);
  });

  it("every preset produces a valid scene with unique layer ids", () => {
    for (const preset of PRESETS) {
      const scene = preset.create();
      const parsed = SceneConfigSchema.safeParse(scene);
      expect(parsed.success, `${preset.id}: ${parsed.error?.issues[0]?.message}`).toBe(true);
      expect(new Set(scene.layers.map((l) => l.id)).size).toBe(scene.layers.length);
      expect(scene.preset).toBe(preset.id);
    }
  });

  it("fallback and default scenes are valid", () => {
    expect(SceneConfigSchema.safeParse(createFallbackScene()).success).toBe(true);
    expect(SceneConfigSchema.safeParse(createScene()).success).toBe(true);
  });

  it("default mappings only use targets the layer type supports", () => {
    for (const type of LAYER_TYPES) {
      for (const m of createLayer(type).reactivity) expect(LAYER_TYPE_INFO[type].targets).toContain(m.target);
    }
  });
});

describe("inspector field registry", () => {
  /** Collects every leaf path of a layer except identity/meta fields. */
  function leafPaths(value: unknown, prefix = ""): string[] {
    if (Array.isArray(value)) return [prefix]; // tuples are edited as a whole (vec3)
    if (value && typeof value === "object") {
      return Object.entries(value).flatMap(([k, v]) => leafPaths(v, prefix ? `${prefix}.${k}` : k));
    }
    return [prefix];
  }

  it.each(LAYER_TYPES)("every editable %s property has an inspector field", (type) => {
    const layer = createLayer(type);
    const covered = new Set(fieldsForLayerType(type).map((f) => f.path));
    const leaves = leafPaths(layer).filter((p) => !["id", "type", "name", "visible", "reactivity"].includes(p));
    for (const p of leaves) expect(covered, `missing inspector field for ${type}.${p}`).toContain(p);
  });

  it.each(LAYER_TYPES)("every %s field path resolves on the layer and bounds match the schema", (type) => {
    const layer = createLayer(type);
    for (const field of fieldsForLayerType(type)) {
      expect(getAtPath(layer, field.path), `${type}.${field.path}`).not.toBeUndefined();
      if (field.control.kind === "slider") {
        const { min, max } = field.control;
        const atMin = setAtPath(layer, field.path, min);
        const below = setAtPath(layer, field.path, min - 1);
        expect(LAYER_SCHEMAS[type].safeParse(atMin).success).toBe(true);
        expect(LAYER_SCHEMAS[type].safeParse(below).success).toBe(false);
        expect(LAYER_SCHEMAS[type].safeParse(setAtPath(layer, field.path, max)).success).toBe(true);
      }
    }
  });

  it("scene-level fields resolve on the default scene", () => {
    const scene = createScene();
    for (const field of SCENE_FIELDS) expect(getAtPath(scene[field.section], field.path), field.path).not.toBeUndefined();
  });

  it("common fields include transform and motion", () => {
    expect(COMMON_LAYER_FIELDS.map((f) => f.path)).toEqual(
      expect.arrayContaining(["transform.position", "transform.rotation", "transform.scale", "motion.spin", "motion.speed", "opacity", "glow"]),
    );
  });
});

describe("sanitizeSceneConfig", () => {
  it("passes valid scenes through unchanged", () => {
    const scene = createPresetScene("crystal-core");
    const result = sanitizeSceneConfig(scene);
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(result.value).toEqual(SceneConfigSchema.parse(scene));
  });

  it("clamps out-of-range numbers, fixes colours and fills missing fields", () => {
    const result = sanitizeSceneConfig({
      name: "AI scene",
      environment: { camera: { fov: 500 }, background: { colorA: "red", colorB: "#abc" } },
      layers: [{ type: "particles", particles: { count: 9_999_999, size: "0.1", colorA: "cyan" } }],
    });
    expect(result.ok).toBe(true);
    const scene = result.value;
    expect(scene.environment.camera.fov).toBe(110);
    expect(scene.environment.background.colorA).toBe("#ff2a3d");
    expect(scene.environment.background.colorB).toBe("#aabbcc");
    const layer = scene.layers[0];
    expect(layer.type).toBe("particles");
    if (layer.type !== "particles") throw new Error("unreachable");
    expect(layer.particles.count).toBe(40000);
    expect(layer.particles.size).toBe(0.1);
    expect(layer.particles.colorA).toBe("#22d3ee");
    expect(layer.transform.scale).toBe(1);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(SceneConfigSchema.safeParse(scene).success).toBe(true);
  });

  it("rejects unsupported layer types, unsupported mapping targets and code-like fields", () => {
    const result = sanitizeSceneConfig({
      layers: [
        { type: "html", content: "<script>alert(1)</script>" },
        { type: "shader", glsl: "void main(){}" },
        {
          type: "grid",
          onFrame: "() => fetch('/x')",
          reactivity: [
            { source: "bass", target: "scale", amount: 1 }, // grid does not support scale
            { source: "bass", target: "explode", amount: 1 },
            { source: "bass", target: "displacement", amount: 99 },
          ],
        },
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.value.layers).toHaveLength(1);
    const grid = result.value.layers[0] as Layer & Record<string, unknown>;
    expect(grid.type).toBe("grid");
    expect(grid.onFrame).toBeUndefined();
    expect(grid.reactivity).toHaveLength(1);
    expect(grid.reactivity[0].target).toBe("displacement");
    expect(grid.reactivity[0].amount).toBe(3);
    expect(result.warnings.some((w) => w.includes('"html"'))).toBe(true);
  });

  it("de-duplicates ids, trims layer count, and drops dangling graph edges", () => {
    const layer = createLayer("shape");
    const result = sanitizeSceneConfig({
      layers: Array.from({ length: 20 }, () => ({ ...layer })),
      graph: {
        enabled: true,
        nodes: [
          { id: "a", kind: "audioBand", band: "bass", x: 0, y: 0 },
          { id: "b", kind: "visualParam", layerId: layer.id, target: "scale", x: 200, y: 0 },
          { id: "c", kind: "teleport", x: 0, y: 0 },
        ],
        edges: [
          { id: "e1", source: "a", target: "b" },
          { id: "e2", source: "a", target: "missing" },
        ],
      },
    });
    expect(result.value.layers).toHaveLength(12);
    expect(new Set(result.value.layers.map((l) => l.id)).size).toBe(12);
    expect(result.value.graph.nodes.map((n) => n.id)).toEqual(["a", "b"]);
    expect(result.value.graph.edges.map((e) => e.id)).toEqual(["e1"]);
  });

  it("returns a fallback for non-objects", () => {
    expect(sanitizeSceneConfig("nope").ok).toBe(false);
    expect(SceneConfigSchema.safeParse(sanitizeSceneConfig(null).value).success).toBe(true);
  });

  it("sanitizeLayer keeps a valid layer identical", () => {
    const layer = createLayer("spectrum");
    expect(sanitizeLayer(layer)).toEqual(layer);
  });
});

describe("applyScenePatch", () => {
  it("applies targeted changes and preserves untouched layers (manual edits)", () => {
    const scene = createPresetScene("neon-tunnel");
    const [tunnel, rings] = scene.layers;
    if (tunnel.type !== "tunnel") throw new Error("preset changed: first layer should be the tunnel");
    // simulate a manual edit the AI does not know about
    const edited = { ...scene, layers: scene.layers.map((l) => (l.id === rings.id ? { ...l, opacity: 0.42 } : l)) };
    const result = applyScenePatch(edited, {
      ops: [
        { op: "updateLayer", layerId: tunnel.id, changes: { tunnel: { colorA: "#00ff00" }, glow: 9 } },
        { op: "addLayer", layer: { type: "spectrum", name: "Bars" } },
        { op: "updateEnvironment", changes: { fog: { density: 1 } } },
        { op: "removeLayer", layerId: "lyr_doesnotexist" },
      ],
    });
    expect(result.applied).toBe(3);
    const nextTunnel = result.scene.layers.find((l) => l.id === tunnel.id)!;
    if (nextTunnel.type !== "tunnel") throw new Error("type changed");
    expect(nextTunnel.tunnel.colorA).toBe("#00ff00");
    expect(nextTunnel.tunnel.colorB).toBe(tunnel.tunnel.colorB);
    expect(nextTunnel.glow).toBe(5);
    expect(result.scene.layers.find((l) => l.id === rings.id)!.opacity).toBe(0.42);
    expect(result.scene.environment.fog.density).toBe(0.15);
    expect(result.addedLayerIds).toHaveLength(1);
    expect(result.warnings.some((w) => w.includes("not found"))).toBe(true);
  });

  it("cannot change a layer's type or id", () => {
    const scene = createPresetScene("monolith");
    const target = scene.layers[0];
    const result = applyScenePatch(scene, { ops: [{ op: "updateLayer", layerId: target.id, changes: { type: "grid", id: "hacked" } }] });
    expect(result.scene.layers[0].id).toBe(target.id);
    expect(result.scene.layers[0].type).toBe(target.type);
  });
});

describe("scene files", () => {
  it("round-trips through the file envelope", () => {
    const scene = createPresetScene("spectrum-halo");
    const json = JSON.parse(JSON.stringify(createSceneFile(scene)));
    const parsed = parseSceneFile(json);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.scene).toEqual(scene);
  });

  it("rejects unrelated JSON", () => {
    expect(parseSceneFile({ hello: "world" }).ok).toBe(false);
    expect(parseSceneFile([1, 2]).ok).toBe(false);
  });
});

describe("JSON Schema export for LLMs", () => {
  it("SceneConfigSchema converts to JSON Schema with numeric bounds", () => {
    const json = z.toJSONSchema(SceneConfigSchema) as { properties: Record<string, unknown> };
    const text = JSON.stringify(json);
    expect(text).toContain('"maximum":40000');
    expect(json.properties.layers).toBeDefined();
  });
});

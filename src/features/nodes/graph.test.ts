import { describe, expect, it } from "vitest";
import { createGraphNode, createLayer } from "@/shared/scene/defaults";
import type { NodeGraph } from "@/shared/scene/schema";
import { defaultTargetFor, validateConnection } from "./graph";

describe("node graph connection rules", () => {
  const band = createGraphNode("audioBand");
  const smooth = createGraphNode("smooth");
  const mul = createGraphNode("multiply");
  const sink = createGraphNode("visualParam");
  const graph: NodeGraph = {
    enabled: true,
    nodes: [band, smooth, mul, sink],
    edges: [
      { id: "edge_a", source: band.id, target: smooth.id },
      { id: "edge_b", source: smooth.id, target: mul.id },
    ],
  };

  it("allows valid edges", () => {
    expect(validateConnection(graph, mul.id, sink.id)).toBeNull();
  });

  it("rejects edges into Audio Band, out of Visual Parameter, self, duplicates and cycles", () => {
    expect(validateConnection(graph, smooth.id, band.id)).toMatch(/Audio Band/);
    expect(validateConnection(graph, sink.id, mul.id)).toMatch(/Visual Parameter/);
    expect(validateConnection(graph, mul.id, mul.id)).not.toBeNull();
    expect(validateConnection(graph, band.id, smooth.id)).toMatch(/already/);
    expect(validateConnection(graph, mul.id, smooth.id)).toMatch(/loop/);
  });

  it("picks scale when the layer supports it", () => {
    expect(defaultTargetFor(createLayer("shape"))).toBe("scale");
    expect(defaultTargetFor(createLayer("grid"))).toBe("opacity");
  });
});

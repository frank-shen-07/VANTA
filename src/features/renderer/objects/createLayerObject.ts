import type { Layer, LayerType } from "@/shared/scene/schema";
import { GridObject } from "./GridObject";
import type { LayerObject } from "./LayerObject";
import { ParticlesObject } from "./ParticlesObject";
import { RingsObject } from "./RingsObject";
import { ShapeObject } from "./ShapeObject";
import { SpectrumObject } from "./SpectrumObject";
import { TunnelObject } from "./TunnelObject";

/** Creates the imperative renderable for a layer type. */
export function createLayerObject(type: LayerType): LayerObject<Layer> {
  switch (type) {
    case "particles":
      return new ParticlesObject() as unknown as LayerObject<Layer>;
    case "rings":
      return new RingsObject() as unknown as LayerObject<Layer>;
    case "shape":
      return new ShapeObject() as unknown as LayerObject<Layer>;
    case "tunnel":
      return new TunnelObject() as unknown as LayerObject<Layer>;
    case "grid":
      return new GridObject() as unknown as LayerObject<Layer>;
    case "spectrum":
      return new SpectrumObject() as unknown as LayerObject<Layer>;
  }
}

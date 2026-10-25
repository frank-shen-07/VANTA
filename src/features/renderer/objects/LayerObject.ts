/**
 * Base class for imperative layer renderables. Each layer type owns its
 * Three.js objects here (outside React) so config changes update uniforms in
 * place and the per-frame path never allocates or touches React state.
 */
import * as THREE from "three";
import { getLayerModulation, liveModulation, type LayerModulation } from "@/shared/modulation/engine";
import { LAYER_TYPE_INFO } from "@/shared/scene/layers";
import type { Layer, MappingTarget } from "@/shared/scene/schema";
import { DEG } from "../lib/math";

export interface LayerEnv {
  /** Draw order (layer index). */
  index: number;
  /** Particle count multiplier from the render quality. */
  particleScale: number;
}

export interface LayerFrameContext {
  /** Clamped seconds since the previous frame. */
  dt: number;
  /** Seconds since the renderer started. */
  elapsed: number;
  camera: THREE.Camera;
  /** Pixels per world unit at distance 1 (for point sprites). */
  pixelScale: number;
}

/** Modulation with unsupported targets zeroed out, reused every frame. */
type Mod = Record<MappingTarget, number>;

export abstract class LayerObject<L extends Layer = Layer> {
  /** Transform group added to the scene graph. */
  readonly root = new THREE.Group();
  protected cfg: L | null = null;
  protected env: LayerEnv = { index: 0, particleScale: 1 };
  /** Layer animation clock: seconds × motion.speed × (1 + speed modulation). */
  protected time = 0;
  private readonly spinAngles = new THREE.Vector3();
  private readonly mod: Mod = { scale: 0, opacity: 0, brightness: 0, speed: 0, rotation: 0, hue: 0, displacement: 0, size: 0, bounce: 0 };
  private supported: ReadonlySet<MappingTarget> = new Set();
  /** Axis that receives the `rotation` modulation (0 = x, 1 = y, 2 = z). */
  protected rotationAxis: 0 | 1 | 2 = 1;

  setConfig(layer: L, env: LayerEnv): void {
    const prev = this.cfg;
    this.cfg = layer;
    this.env = env;
    if (!prev || prev.type !== layer.type) this.supported = new Set(LAYER_TYPE_INFO[layer.type].targets);
    this.root.visible = layer.visible;
    this.root.renderOrder = env.index;
    this.applyConfig(layer, prev, env);
    this.root.traverse((o) => {
      o.renderOrder = env.index;
    });
  }

  update(ctx: LayerFrameContext): void {
    const cfg = this.cfg;
    if (!cfg || !cfg.visible) return;
    const live = getLayerModulation(liveModulation, cfg.id);
    const mod = this.mod;
    for (const key in mod) {
      const k = key as MappingTarget;
      mod[k] = this.supported.has(k) ? live[k] : 0;
    }
    const speedK = Math.max(0, 1 + mod.speed);
    this.time += ctx.dt * cfg.motion.speed * speedK;
    const spin = cfg.motion.spin;
    this.spinAngles.x += spin[0] * ctx.dt * speedK;
    this.spinAngles.y += spin[1] * ctx.dt * speedK;
    this.spinAngles.z += spin[2] * ctx.dt * speedK;
    const t = cfg.transform;
    this.root.position.set(t.position[0], t.position[1] + mod.bounce, t.position[2]);
    const axis = this.rotationAxis;
    this.root.rotation.set(
      t.rotation[0] * DEG + this.spinAngles.x + (axis === 0 ? mod.rotation : 0),
      t.rotation[1] * DEG + this.spinAngles.y + (axis === 1 ? mod.rotation : 0),
      t.rotation[2] * DEG + this.spinAngles.z + (axis === 2 ? mod.rotation : 0),
    );
    const s = t.scale * Math.max(0.001, 1 + mod.scale);
    this.root.scale.setScalar(s);
    this.frame(ctx, cfg, mod);
  }

  /** Apply a new config (rebuild GPU buffers only when structural fields change). */
  protected abstract applyConfig(layer: L, prev: L | null, env: LayerEnv): void;
  /** Per-frame update of uniforms / instance matrices. Must not allocate. */
  protected abstract frame(ctx: LayerFrameContext, layer: L, mod: Readonly<LayerModulation>): void;
  abstract dispose(): void;
}

export function blendingOf(mode: "normal" | "additive"): THREE.Blending {
  return mode === "additive" ? THREE.AdditiveBlending : THREE.NormalBlending;
}

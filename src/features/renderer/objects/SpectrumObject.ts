import * as THREE from "three";
import type { LayerModulation } from "@/shared/modulation/engine";
import { audioBus } from "@/shared/runtime/audioBus";
import type { SpectrumLayer } from "@/shared/scene/schema";
import { hueTurns, multiplyMod, opacityMod, resampleSpectrum, smoothBars } from "../lib/math";
import { LayerObject, blendingOf, type LayerEnv, type LayerFrameContext } from "./LayerObject";

const MAX_BARS = 128;

export class SpectrumObject extends LayerObject<SpectrumLayer> {
  private readonly material: THREE.MeshBasicMaterial;
  private readonly mesh: THREE.InstancedMesh;
  private readonly dummy = new THREE.Object3D();
  private readonly colorA = new THREE.Color();
  private readonly colorB = new THREE.Color();
  private readonly tmp = new THREE.Color();
  private target = new Float32Array(0);
  private heights = new Float32Array(0);

  constructor() {
    super();
    this.rotationAxis = 2;
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    geometry.translate(0, 0.5, 0);
    this.material = new THREE.MeshBasicMaterial({ transparent: true });
    this.mesh = new THREE.InstancedMesh(geometry, this.material, MAX_BARS);
    this.mesh.setColorAt(0, this.tmp);
    this.mesh.frustumCulled = false;
    this.root.add(this.mesh);
  }

  protected applyConfig(layer: SpectrumLayer, _prev: SpectrumLayer | null, env: LayerEnv): void {
    void env;
    const s = layer.spectrum;
    const bars = Math.min(MAX_BARS, s.bars);
    if (this.target.length !== bars) {
      this.target = new Float32Array(bars);
      this.heights = new Float32Array(bars);
    }
    this.mesh.count = bars;
    this.mesh.boundingSphere = null;
    this.colorA.set(s.colorA);
    this.colorB.set(s.colorB);
    const additive = layer.blending === "additive";
    this.material.blending = blendingOf(layer.blending);
    this.material.depthWrite = !additive;
  }

  protected frame(ctx: LayerFrameContext, layer: SpectrumLayer, mod: Readonly<LayerModulation>): void {
    const s = layer.spectrum;
    const bars = this.target.length;
    resampleSpectrum(audioBus.spectrum, this.target, s.mirror);
    smoothBars(this.heights, this.target, ctx.dt);
    const gain = Math.max(0, 1 + mod.displacement);
    const hue = hueTurns(mod.hue);
    const d = this.dummy;
    const step = (Math.PI * 2) / Math.max(1, bars);
    for (let i = 0; i < bars; i++) {
      const v = this.heights[i];
      const h = Math.max(0.02, s.maxHeight * (0.03 + 0.97 * Math.min(1.5, v * gain)));
      if (s.layout === "circle") {
        const theta = i * step + Math.PI / 2;
        d.position.set(Math.cos(theta) * s.radius, Math.sin(theta) * s.radius, 0);
        d.rotation.set(0, 0, theta - Math.PI / 2);
      } else {
        const span = (s.radius * 2) / Math.max(1, bars);
        d.position.set(-s.radius + (i + 0.5) * span, 0, 0);
        d.rotation.set(0, 0, 0);
      }
      d.scale.set(s.barWidth, h, s.barWidth);
      d.updateMatrix();
      this.mesh.setMatrixAt(i, d.matrix);
      const f = bars > 1 ? (s.mirror ? 1 - Math.abs((2 * i) / (bars - 1) - 1) : i / (bars - 1)) : 0;
      this.tmp.copy(this.colorA).lerp(this.colorB, f).offsetHSL(hue, 0, 0).multiplyScalar(0.35 + 0.65 * Math.min(1, v));
      this.mesh.setColorAt(i, this.tmp);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    const k = multiplyMod(layer.glow, mod.brightness);
    this.material.color.setRGB(k, k, k);
    this.material.opacity = opacityMod(layer.opacity, mod.opacity);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mesh.dispose();
  }
}

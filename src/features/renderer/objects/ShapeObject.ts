import * as THREE from "three";
import type { LayerModulation } from "@/shared/modulation/engine";
import type { ShapeLayer } from "@/shared/scene/schema";
import { hueTurns, multiplyMod, opacityMod } from "../lib/math";
import { SIMPLEX_GLSL } from "../shaders/chunks";
import { LayerObject, blendingOf, type LayerEnv, type LayerFrameContext } from "./LayerObject";

const MAX_INSTANCES = 32;

function buildGeometry(kind: ShapeLayer["shape"]["geometry"], detail: number): THREE.BufferGeometry {
  switch (kind) {
    case "icosahedron":
      return new THREE.IcosahedronGeometry(1, detail);
    case "octahedron":
      return new THREE.OctahedronGeometry(1, detail);
    case "dodecahedron":
      return new THREE.DodecahedronGeometry(1, detail);
    case "tetrahedron":
      return new THREE.TetrahedronGeometry(1, detail);
    case "torus":
      return new THREE.TorusGeometry(0.8, 0.3, 8 + detail * 8, 24 + detail * 24);
    case "torusKnot":
      return new THREE.TorusKnotGeometry(0.7, 0.24, 48 + detail * 48, 8 + detail * 4);
    case "sphere":
      return new THREE.SphereGeometry(1, 16 + detail * 12, 10 + detail * 8);
    case "box": {
      const s = 1 + detail * 2;
      return new THREE.BoxGeometry(1.4, 1.4, 1.4, s, s, s);
    }
  }
}

export class ShapeObject extends LayerObject<ShapeLayer> {
  private readonly material: THREE.MeshStandardMaterial;
  private readonly mesh: THREE.InstancedMesh;
  private readonly uTime = { value: 0 };
  private readonly uDistort = { value: 0 };
  private readonly baseColor = new THREE.Color();
  private readonly baseEmissive = new THREE.Color();
  private readonly dummy = new THREE.Object3D();
  private structureKey = "";

  constructor() {
    super();
    this.rotationAxis = 1;
    this.material = new THREE.MeshStandardMaterial();
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.uTime;
      shader.uniforms.uDistort = this.uDistort;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>\nuniform float uTime;\nuniform float uDistort;\n${SIMPLEX_GLSL}`)
        .replace(
          "#include <begin_vertex>",
          `vec3 transformed = vec3(position);
           float vantaN = vantaSnoise(position * 1.6 + vec3(uTime * 0.5));
           transformed += normalize(position + vec3(1e-5)) * vantaN * uDistort * 0.4;`,
        );
    };
    this.material.customProgramCacheKey = () => "vanta-shape-distort";
    this.mesh = new THREE.InstancedMesh(new THREE.BufferGeometry(), this.material, MAX_INSTANCES);
    this.mesh.frustumCulled = false;
    this.root.add(this.mesh);
  }

  protected applyConfig(layer: ShapeLayer, prev: ShapeLayer | null, env: LayerEnv): void {
    void env;
    const s = layer.shape;
    const key = `${s.geometry}|${s.detail}`;
    if (key !== this.structureKey) {
      this.structureKey = key;
      const old = this.mesh.geometry;
      this.mesh.geometry = buildGeometry(s.geometry, s.detail);
      old.dispose();
    }
    this.mesh.count = Math.min(MAX_INSTANCES, s.instances);
    this.mesh.boundingSphere = null;
    const m = this.material;
    this.baseColor.set(s.color);
    this.baseEmissive.set(s.emissive);
    m.metalness = s.metalness;
    m.roughness = s.roughness;
    m.wireframe = s.wireframe;
    if (m.flatShading !== s.flatShading || !prev) {
      m.flatShading = s.flatShading;
      m.needsUpdate = true;
    }
    const additive = layer.blending === "additive";
    m.blending = blendingOf(layer.blending);
    m.transparent = additive || layer.opacity < 1 || layer.reactivity.some((r) => r.target === "opacity");
    m.depthWrite = !additive;
  }

  protected frame(_ctx: LayerFrameContext, layer: ShapeLayer, mod: Readonly<LayerModulation>): void {
    const s = layer.shape;
    this.uTime.value = this.time;
    this.uDistort.value = Math.max(0, s.distortion + mod.displacement);
    const hue = hueTurns(mod.hue);
    const m = this.material;
    m.color.copy(this.baseColor).offsetHSL(hue, 0, 0);
    m.emissive.copy(this.baseEmissive).offsetHSL(hue, 0, 0).multiplyScalar(multiplyMod(layer.glow, mod.brightness));
    m.opacity = opacityMod(layer.opacity, mod.opacity);
    const n = this.mesh.count;
    const orbit = s.orbitRadius;
    const d = this.dummy;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + this.time * 0.25;
      if (n === 1 && orbit === 0) {
        d.position.set(0, 0, 0);
        d.rotation.set(0, 0, 0);
      } else {
        d.position.set(Math.cos(a) * orbit, Math.sin(this.time * 0.8 + i) * 0.15 * Math.max(1, orbit * 0.3), Math.sin(a) * orbit);
        d.rotation.set(this.time * 0.5 + i, this.time * 0.7 + i * 1.3, 0);
      }
      d.updateMatrix();
      this.mesh.setMatrixAt(i, d.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mesh.dispose();
  }
}

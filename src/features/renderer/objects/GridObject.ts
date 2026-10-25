import * as THREE from "three";
import type { LayerModulation } from "@/shared/modulation/engine";
import type { GridLayer } from "@/shared/scene/schema";
import { hueTurns, multiplyMod, opacityMod } from "../lib/math";
import { FOG_APPLY_GLSL, HUE_SHIFT_GLSL } from "../shaders/chunks";
import { LayerObject, blendingOf, type LayerEnv, type LayerFrameContext } from "./LayerObject";

const VERTEX = /* glsl */ `
uniform float uTime;
uniform float uWave;
uniform float uSize;
uniform float uCell;
varying vec2 vG;
varying vec2 vLocal;
varying float vH;
#include <fog_pars_vertex>

float vantaTerrain(vec2 g) {
  float valley = smoothstep(uSize * 0.03, uSize * 0.16, abs(g.x));
  float h = sin(g.x * 0.21 + g.y * 0.13) * 0.5 + sin(g.x * 0.09 - g.y * 0.27 + 1.3) * 0.35 + sin(g.y * 0.41 + g.x * 0.05) * 0.15;
  return (h * 0.5 + 0.5) * valley * 2.2 + 0.25 * sin(g.y * 0.35 + uTime * 1.5) * (0.4 + valley);
}

void main() {
  vec3 p = position;
  float scroll = uTime * uCell * 2.0;
  vec2 g = vec2(p.x, p.z - scroll);
  float h = vantaTerrain(g) * uWave;
  p.y += h;
  vG = g;
  vLocal = position.xz;
  vH = h;
  vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uCell;
uniform float uGlow;
uniform float uOpacity;
uniform float uHue;
uniform float uAdditive;
uniform float uSize;
uniform float uWave;
varying vec2 vG;
varying vec2 vLocal;
varying float vH;
#include <fog_pars_fragment>
${HUE_SHIFT_GLSL}

void main() {
  vec2 c = vG / uCell;
  vec2 fw = max(fwidth(c), vec2(1e-4));
  vec2 gd = abs(fract(c - 0.5) - 0.5) / fw;
  float line = 1.0 - min(min(gd.x, gd.y) / 1.2, 1.0);
  vec3 col = vantaHueShift(uColor, uHue);
  float fade = 1.0 - smoothstep(uSize * 0.3, uSize * 0.5, max(abs(vLocal.x), abs(vLocal.y)));
  float height = clamp(vH / max(0.5, uWave * 2.2), 0.0, 1.0);
  vec3 outColor = col * (line * (0.5 + uGlow) + 0.025 + 0.1 * height);
  float outAlpha = fade * uOpacity * mix(0.85, 1.0, line);
  ${FOG_APPLY_GLSL}
  gl_FragColor = vec4(outColor, outAlpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class GridObject extends LayerObject<GridLayer> {
  private readonly material: THREE.ShaderMaterial;
  private readonly mesh: THREE.Mesh;
  private structureKey = "";

  constructor() {
    super();
    this.rotationAxis = 1;
    this.material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uTime: { value: 0 },
          uWave: { value: 1 },
          uSize: { value: 160 },
          uCell: { value: 2.5 },
          uColor: { value: new THREE.Color() },
          uGlow: { value: 1 },
          uOpacity: { value: 1 },
          uHue: { value: 0 },
          uAdditive: { value: 1 },
        },
      ]),
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
    });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
    this.mesh.frustumCulled = false;
    this.root.add(this.mesh);
  }

  protected applyConfig(layer: GridLayer, _prev: GridLayer | null, env: LayerEnv): void {
    void env;
    const g = layer.grid;
    const segments = Math.max(16, Math.min(256, g.divisions * 2));
    const key = `${g.size}|${segments}`;
    if (key !== this.structureKey) {
      this.structureKey = key;
      const geometry = new THREE.PlaneGeometry(g.size, g.size, segments, segments);
      geometry.rotateX(-Math.PI / 2);
      const old = this.mesh.geometry;
      this.mesh.geometry = geometry;
      old.dispose();
    }
    const u = this.material.uniforms;
    u.uSize.value = g.size;
    u.uCell.value = g.size / g.divisions;
    u.uColor.value.set(g.color);
    u.uAdditive.value = layer.blending === "additive" ? 1 : 0;
    this.material.blending = blendingOf(layer.blending);
  }

  protected frame(_ctx: LayerFrameContext, layer: GridLayer, mod: Readonly<LayerModulation>): void {
    const u = this.material.uniforms;
    u.uTime.value = this.time;
    u.uWave.value = Math.max(0, layer.grid.wave + mod.displacement);
    u.uHue.value = hueTurns(mod.hue);
    u.uOpacity.value = opacityMod(layer.opacity, mod.opacity);
    u.uGlow.value = multiplyMod(layer.glow, mod.brightness);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

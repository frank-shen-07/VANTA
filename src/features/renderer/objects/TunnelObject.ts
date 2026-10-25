import * as THREE from "three";
import type { LayerModulation } from "@/shared/modulation/engine";
import type { TunnelLayer } from "@/shared/scene/schema";
import { hueTurns, multiplyMod, opacityMod } from "../lib/math";
import { FOG_APPLY_GLSL, HUE_SHIFT_GLSL } from "../shaders/chunks";
import { LayerObject, blendingOf, type LayerEnv, type LayerFrameContext } from "./LayerObject";

const VERTEX = /* glsl */ `
uniform float uTime;
uniform float uRadius;
uniform float uLength;
uniform float uTwist;
uniform float uDisplacement;
varying vec2 vUv;
varying float vAlong;
#include <fog_pars_vertex>

void main() {
  float along = position.z + 0.5;
  float ang = atan(position.y, position.x) + uTwist * 6.2831853 * along;
  float r = uRadius * (1.0 + uDisplacement * 0.18 * sin(along * uLength * 0.25 - uTime * 4.0));
  vec3 p = vec3(cos(ang) * r, sin(ang) * r, (along - 0.85) * uLength);
  vUv = uv;
  vAlong = along;
  vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uStripes;
uniform float uSides;
uniform float uWire;
uniform float uOpacity;
uniform float uGlow;
uniform float uAdditive;
uniform float uHue;
uniform vec3 uColorA;
uniform vec3 uColorB;
varying vec2 vUv;
varying float vAlong;
#include <fog_pars_fragment>
${HUE_SHIFT_GLSL}

float vLine(float x, float w) {
  float fw = max(fwidth(x), 1e-4);
  float g = abs(fract(x - 0.5) - 0.5);
  return 1.0 - smoothstep(w, w + fw * 1.5, g);
}

void main() {
  float s = vAlong * uStripes - uTime * 0.6;
  float ring = vLine(s, 0.03);
  float seam = vLine(vUv.x * uSides, 0.015);
  vec3 base = vantaHueShift(mix(uColorA, uColorB, vAlong), uHue);
  float pulse = 0.5 + 0.5 * sin(s * 6.2831853);
  float bright = uWire > 0.5 ? (0.5 + 1.1 * ring) : (0.05 + 1.0 * ring + 0.5 * seam + 0.06 * pulse);
  float fade = smoothstep(0.0, 0.4, vAlong) * (1.0 - smoothstep(0.9, 1.0, vAlong));
  vec3 outColor = base * bright * (0.3 + uGlow);
  float outAlpha = fade * uOpacity;
  ${FOG_APPLY_GLSL}
  gl_FragColor = vec4(outColor, outAlpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class TunnelObject extends LayerObject<TunnelLayer> {
  private readonly material: THREE.ShaderMaterial;
  private readonly mesh: THREE.Mesh;
  private structureKey = "";

  constructor() {
    super();
    this.rotationAxis = 2;
    this.material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uTime: { value: 0 },
          uRadius: { value: 6 },
          uLength: { value: 120 },
          uTwist: { value: 0 },
          uDisplacement: { value: 0 },
          uStripes: { value: 24 },
          uSides: { value: 12 },
          uWire: { value: 0 },
          uOpacity: { value: 1 },
          uGlow: { value: 1 },
          uAdditive: { value: 1 },
          uHue: { value: 0 },
          uColorA: { value: new THREE.Color() },
          uColorB: { value: new THREE.Color() },
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

  protected applyConfig(layer: TunnelLayer, _prev: TunnelLayer | null, env: LayerEnv): void {
    void env;
    const t = layer.tunnel;
    const segments = Math.max(8, Math.min(120, Math.round(t.length / 2)));
    const key = `${t.sides}|${segments}`;
    if (key !== this.structureKey) {
      this.structureKey = key;
      const geometry = new THREE.CylinderGeometry(1, 1, 1, t.sides, segments, true);
      geometry.rotateX(Math.PI / 2);
      const old = this.mesh.geometry;
      this.mesh.geometry = geometry;
      old.dispose();
    }
    const u = this.material.uniforms;
    u.uRadius.value = t.radius;
    u.uLength.value = t.length;
    u.uTwist.value = t.twist;
    u.uStripes.value = t.stripes;
    u.uSides.value = t.sides;
    u.uWire.value = t.wireframe ? 1 : 0;
    u.uColorA.value.set(t.colorA);
    u.uColorB.value.set(t.colorB);
    u.uAdditive.value = layer.blending === "additive" ? 1 : 0;
    this.material.wireframe = t.wireframe;
    this.material.blending = blendingOf(layer.blending);
  }

  protected frame(_ctx: LayerFrameContext, layer: TunnelLayer, mod: Readonly<LayerModulation>): void {
    const u = this.material.uniforms;
    u.uTime.value = this.time;
    u.uDisplacement.value = mod.displacement;
    u.uHue.value = hueTurns(mod.hue);
    u.uOpacity.value = opacityMod(layer.opacity, mod.opacity);
    u.uGlow.value = multiplyMod(layer.glow, mod.brightness);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

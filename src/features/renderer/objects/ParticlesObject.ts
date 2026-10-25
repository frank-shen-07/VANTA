import * as THREE from "three";
import type { LayerModulation } from "@/shared/modulation/engine";
import type { ParticlesLayer } from "@/shared/scene/schema";
import { generateParticles, hashString, hueTurns, multiplyMod, opacityMod, tunnelExtent } from "../lib/math";
import { FOG_APPLY_GLSL, HUE_SHIFT_GLSL } from "../shaders/chunks";
import { LayerObject, blendingOf, type LayerEnv, type LayerFrameContext } from "./LayerObject";

const VERTEX = /* glsl */ `
uniform float uTime;
uniform float uClock;
uniform float uSize;
uniform float uPixelScale;
uniform float uTurbulence;
uniform float uTwinkle;
uniform float uDisplacement;
uniform float uSpread;
uniform float uFlow;
uniform float uTunnelMin;
uniform float uTunnelLen;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform float uHue;
attribute vec4 aRandom;
varying vec3 vColor;
varying float vAlpha;
#include <fog_pars_vertex>
${HUE_SHIFT_GLSL}

void main() {
  vec3 p = position;
  float fade = 1.0;
  if (uFlow > 0.5) {
    float d = mod(p.z - uTunnelMin + uTime * uSpread * 0.9, uTunnelLen);
    p.z = uTunnelMin + d;
    float k = d / uTunnelLen;
    fade = smoothstep(0.0, 0.18, k) * (1.0 - smoothstep(0.86, 1.0, k));
  }
  // Turbulence: a smooth, per-particle flow field.
  vec3 ph = aRandom.xyz * 6.2831853;
  vec3 q = p * (0.9 / max(1.0, uSpread)) * 3.0;
  vec3 flow = vec3(
    sin(q.y * 1.7 + uTime * 0.9 + ph.x),
    sin(q.z * 1.3 + uTime * 1.1 + ph.y),
    sin(q.x * 1.5 + uTime * 0.8 + ph.z)
  );
  p += flow * uTurbulence * (0.15 + 0.06 * uSpread);
  // Displacement: radial explode, scaled with the distribution size.
  float len = length(uFlow > 0.5 ? vec3(p.xy, 0.0) : p);
  vec3 dir = len > 1e-4 ? (uFlow > 0.5 ? vec3(p.xy, 0.0) : p) / len : vec3(0.0, 1.0, 0.0);
  p += dir * uDisplacement * (0.5 + aRandom.w * 0.7) * (0.12 * uSpread + 0.4);

  vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  float tw = 1.0 - uTwinkle * (0.5 + 0.5 * sin(uClock * (1.5 + aRandom.y * 4.0) + aRandom.x * 6.2831853));
  gl_PointSize = max(1.0, uSize * (0.45 + aRandom.z * 1.1) * uPixelScale / max(0.05, -mvPosition.z));
  vColor = vantaHueShift(mix(uColorA, uColorB, aRandom.w), uHue);
  vAlpha = tw * fade;
  #include <fog_vertex>
}
`;

const FRAGMENT = /* glsl */ `
uniform float uOpacity;
uniform float uGlow;
uniform float uAdditive;
varying vec3 vColor;
varying float vAlpha;
#include <fog_pars_fragment>

void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  if (d > 0.5) discard;
  float core = 1.0 - smoothstep(0.0, 0.5, d);
  float a = (core * core * 0.85 + smoothstep(0.22, 0.0, d) * 0.6) * vAlpha * uOpacity;
  vec3 outColor = vColor * (0.35 + uGlow);
  float outAlpha = a;
  ${FOG_APPLY_GLSL}
  gl_FragColor = vec4(outColor, outAlpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class ParticlesObject extends LayerObject<ParticlesLayer> {
  private readonly material: THREE.ShaderMaterial;
  private readonly points: THREE.Points;
  private structureKey = "";

  constructor() {
    super();
    this.rotationAxis = 1;
    this.material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uTime: { value: 0 },
          uClock: { value: 0 },
          uSize: { value: 0.06 },
          uPixelScale: { value: 800 },
          uTurbulence: { value: 0 },
          uTwinkle: { value: 0 },
          uDisplacement: { value: 0 },
          uSpread: { value: 10 },
          uFlow: { value: 0 },
          uTunnelMin: { value: -60 },
          uTunnelLen: { value: 70 },
          uColorA: { value: new THREE.Color() },
          uColorB: { value: new THREE.Color() },
          uHue: { value: 0 },
          uOpacity: { value: 1 },
          uGlow: { value: 1 },
          uAdditive: { value: 1 },
        },
      ]),
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    this.points = new THREE.Points(new THREE.BufferGeometry(), this.material);
    this.points.frustumCulled = false;
    this.root.add(this.points);
  }

  protected applyConfig(layer: ParticlesLayer, _prev: ParticlesLayer | null, env: LayerEnv): void {
    const p = layer.particles;
    const count = Math.max(100, Math.round(p.count * env.particleScale));
    const key = `${p.distribution}|${count}|${p.spread}|${layer.id}`;
    if (key !== this.structureKey) {
      this.structureKey = key;
      const { positions, randoms } = generateParticles(p.distribution, count, p.spread, hashString(layer.id));
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute("aRandom", new THREE.BufferAttribute(randoms, 4));
      geometry.computeBoundingSphere();
      const old = this.points.geometry;
      this.points.geometry = geometry;
      old.dispose();
    }
    const u = this.material.uniforms;
    u.uColorA.value.set(p.colorA);
    u.uColorB.value.set(p.colorB);
    u.uSpread.value = p.spread;
    const tunnel = p.distribution === "tunnel";
    u.uFlow.value = tunnel ? 1 : 0;
    const ext = tunnelExtent(p.spread);
    u.uTunnelMin.value = ext.zMin;
    u.uTunnelLen.value = ext.zMax - ext.zMin;
    const additive = layer.blending === "additive";
    u.uAdditive.value = additive ? 1 : 0;
    if (this.material.blending !== blendingOf(layer.blending)) {
      this.material.blending = blendingOf(layer.blending);
      this.material.needsUpdate = true;
    }
  }

  protected frame(ctx: LayerFrameContext, layer: ParticlesLayer, mod: Readonly<LayerModulation>): void {
    const p = layer.particles;
    const u = this.material.uniforms;
    u.uTime.value = this.time;
    u.uClock.value = ctx.elapsed;
    u.uSize.value = multiplyMod(p.size, mod.size);
    u.uPixelScale.value = ctx.pixelScale;
    u.uTurbulence.value = p.turbulence;
    u.uTwinkle.value = p.twinkle;
    u.uDisplacement.value = mod.displacement;
    u.uHue.value = hueTurns(mod.hue);
    u.uOpacity.value = opacityMod(layer.opacity, mod.opacity);
    u.uGlow.value = multiplyMod(layer.glow, mod.brightness);
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}

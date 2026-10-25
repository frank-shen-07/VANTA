import * as THREE from "three";
import type { LayerModulation } from "@/shared/modulation/engine";
import type { RingsLayer } from "@/shared/scene/schema";
import { hueTurns, multiplyMod, opacityMod, ringRadius, ringTunnelZ } from "../lib/math";
import { FOG_APPLY_GLSL, HUE_SHIFT_GLSL } from "../shaders/chunks";
import { LayerObject, blendingOf, type LayerEnv, type LayerFrameContext } from "./LayerObject";

const ARRANGEMENT_INDEX = { tunnel: 0, concentric: 1, orbit: 2 } as const;

const VERTEX = /* glsl */ `
uniform float uTime;
uniform float uCount;
uniform float uRadius;
uniform float uSpacing;
uniform float uThickness;
uniform float uWave;
uniform float uArr;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform float uHue;
attribute vec2 aRing;
attribute float aIndex;
varying vec3 vColor;
varying float vEdge;
varying float vFade;
#include <fog_pars_vertex>
${HUE_SHIFT_GLSL}
mat3 vRotX(float a) { float c = cos(a); float s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
mat3 vRotY(float a) { float c = cos(a); float s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }

void main() {
  float i = aIndex;
  float t01 = uCount > 1.0 ? i / (uCount - 1.0) : 0.0;
  float ang = aRing.x;
  float r = uRadius;
  vec3 center = vec3(0.0);
  mat3 R = mat3(1.0);
  float fade = 1.0;
  float sp = max(uSpacing, 0.25);
  if (uArr < 0.5) {
    float L = max(1.0, uCount) * sp;
    float d = mod(i * sp - uTime * sp * 0.9, L);
    center.z = L * 0.15 - d;
    float k = d / L;
    fade = smoothstep(0.0, 0.06, k) * (1.0 - smoothstep(0.6, 1.0, k));
  } else if (uArr < 1.5) {
    r = uRadius + i * uSpacing;
    ang += uTime * 0.12 * (mod(i, 2.0) < 0.5 ? 1.0 : -1.0);
  } else {
    r = uRadius + i * uSpacing * 0.2;
    R = vRotY(i * 2.39996 + uTime * 0.35) * vRotX(t01 * 3.14159 + uTime * 0.2);
  }
  float wave = uWave * r * (0.08 * sin(ang * 3.0 + uTime * 2.0 + i * 0.7) + 0.05 * sin(uTime * 1.3 + i * 0.9));
  float rr = max(0.0, r + wave) + aRing.y * uThickness * 0.5;
  vec3 p = center + R * vec3(cos(ang) * rr, sin(ang) * rr, 0.0);
  vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  vColor = vantaHueShift(mix(uColorA, uColorB, t01), uHue);
  vEdge = aRing.y;
  vFade = fade;
  #include <fog_vertex>
}
`;

const FRAGMENT = /* glsl */ `
uniform float uOpacity;
uniform float uGlow;
uniform float uAdditive;
varying vec3 vColor;
varying float vEdge;
varying float vFade;
#include <fog_pars_fragment>

void main() {
  float prof = 1.0 - pow(abs(vEdge), 3.0);
  vec3 outColor = vColor * (0.4 + uGlow);
  float outAlpha = prof * vFade * uOpacity;
  ${FOG_APPLY_GLSL}
  gl_FragColor = vec4(outColor, outAlpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

function buildRingGeometry(sides: number, count: number): THREE.InstancedBufferGeometry {
  const verts = (sides + 1) * 2;
  const positions = new Float32Array(verts * 3);
  const ring = new Float32Array(verts * 2);
  // Rotate so triangles/squares sit upright.
  const offset = sides === 4 ? Math.PI / 4 : Math.PI / 2;
  for (let k = 0; k <= sides; k++) {
    const a = (k / sides) * Math.PI * 2 + offset;
    for (let s = 0; s < 2; s++) {
      const v = k * 2 + s;
      positions[v * 3] = Math.cos(a);
      positions[v * 3 + 1] = Math.sin(a);
      ring[v * 2] = a;
      ring[v * 2 + 1] = s === 0 ? -1 : 1;
    }
  }
  const index: number[] = [];
  for (let k = 0; k < sides; k++) {
    const a = k * 2;
    index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("aRing", new THREE.BufferAttribute(ring, 2));
  geometry.setIndex(index);
  const ids = new Float32Array(count);
  for (let i = 0; i < count; i++) ids[i] = i;
  geometry.setAttribute("aIndex", new THREE.InstancedBufferAttribute(ids, 1));
  geometry.instanceCount = count;
  return geometry;
}

export class RingsObject extends LayerObject<RingsLayer> {
  private readonly material: THREE.ShaderMaterial;
  private readonly mesh: THREE.Mesh;
  private structureKey = "";
  private readonly inv = new THREE.Matrix4();
  private readonly ray = new THREE.Ray();
  private readonly plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  private readonly hit = new THREE.Vector3();

  constructor() {
    super();
    this.rotationAxis = 2;
    this.material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uTime: { value: 0 },
          uCount: { value: 1 },
          uRadius: { value: 4 },
          uSpacing: { value: 1 },
          uThickness: { value: 0.05 },
          uWave: { value: 0 },
          uArr: { value: 0 },
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
      side: THREE.DoubleSide,
      fog: true,
    });
    this.mesh = new THREE.Mesh(new THREE.InstancedBufferGeometry(), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.raycast = (raycaster, intersects) => this.raycastRings(raycaster, intersects);
    this.root.add(this.mesh);
  }

  /** Analytic raycast: the shader positions rings, so test each ring circle on the CPU. */
  private raycastRings(raycaster: THREE.Raycaster, intersects: THREE.Intersection[]): void {
    const cfg = this.cfg;
    if (!cfg) return;
    const r = cfg.rings;
    this.inv.copy(this.mesh.matrixWorld).invert();
    this.ray.copy(raycaster.ray).applyMatrix4(this.inv);
    for (let i = 0; i < r.count; i++) {
      const radius = ringRadius(r.arrangement, i, r.radius, r.spacing);
      const z = r.arrangement === "tunnel" ? ringTunnelZ(i, r.count, r.spacing, this.time) : 0;
      this.plane.constant = -z;
      if (!this.ray.intersectPlane(this.plane, this.hit)) continue;
      const d = Math.hypot(this.hit.x, this.hit.y);
      const tol = Math.max(r.thickness * 2, radius * 0.08);
      if (Math.abs(d - radius) > tol) continue;
      const point = this.hit.clone().applyMatrix4(this.mesh.matrixWorld);
      intersects.push({ distance: raycaster.ray.origin.distanceTo(point), point, object: this.mesh });
      return;
    }
  }

  protected applyConfig(layer: RingsLayer, _prev: RingsLayer | null, env: LayerEnv): void {
    void env;
    const r = layer.rings;
    const key = `${r.sides}|${r.count}`;
    if (key !== this.structureKey) {
      this.structureKey = key;
      const old = this.mesh.geometry;
      this.mesh.geometry = buildRingGeometry(r.sides, r.count);
      old.dispose();
    }
    const u = this.material.uniforms;
    u.uCount.value = r.count;
    u.uRadius.value = r.radius;
    u.uSpacing.value = r.spacing;
    u.uArr.value = ARRANGEMENT_INDEX[r.arrangement];
    u.uColorA.value.set(r.colorA);
    u.uColorB.value.set(r.colorB);
    u.uAdditive.value = layer.blending === "additive" ? 1 : 0;
    this.material.blending = blendingOf(layer.blending);
  }

  protected frame(_ctx: LayerFrameContext, layer: RingsLayer, mod: Readonly<LayerModulation>): void {
    const r = layer.rings;
    const u = this.material.uniforms;
    u.uTime.value = this.time;
    u.uThickness.value = multiplyMod(r.thickness, mod.size);
    u.uWave.value = Math.max(0, r.wave + mod.displacement);
    u.uHue.value = hueTurns(mod.hue);
    u.uOpacity.value = opacityMod(layer.opacity, mod.opacity);
    u.uGlow.value = multiplyMod(layer.glow, mod.brightness);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

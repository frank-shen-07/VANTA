/**
 * Background (solid / gradient / procedural nebula), fog and lighting.
 * Owns its Three.js objects; config is applied when the environment object
 * reference changes, so the per-frame path only updates a time uniform.
 */
import * as THREE from "three";
import type { Environment } from "@/shared/scene/schema";
import { SIMPLEX_GLSL } from "../shaders/chunks";

const MODE_INDEX = { solid: 0, gradient: 1, nebula: 2 } as const;

const BG_VERTEX = /* glsl */ `
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
varying vec3 vDir;
void main() {
  vec4 v = uInvProj * vec4(position.xy, 1.0, 1.0);
  v /= v.w;
  vDir = (uCamWorld * vec4(v.xyz, 0.0)).xyz;
  gl_Position = vec4(position.xy, 0.999, 1.0);
}
`;

const BG_FRAGMENT = /* glsl */ `
uniform float uMode;
uniform float uIntensity;
uniform float uTime;
uniform vec3 uColorA;
uniform vec3 uColorB;
varying vec3 vDir;
${SIMPLEX_GLSL}
float vantaFbm(vec3 p) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < 4; i++) {
    s += a * vantaSnoise(p);
    p *= 2.03;
    a *= 0.5;
  }
  return s;
}
void main() {
  vec3 d = normalize(vDir);
  vec3 col;
  if (uMode < 0.5) {
    col = uColorA;
  } else if (uMode < 1.5) {
    float t = smoothstep(-0.45, 0.75, d.y);
    col = mix(uColorA, uColorB, t) + uColorB * 0.25 * exp(-abs(d.y) * 6.0);
  } else {
    float n = vantaFbm(d * 1.6 + vec3(0.0, 0.0, uTime * 0.01));
    float n2 = vantaFbm(d * 3.1 - vec3(uTime * 0.006));
    col = uColorA + uColorB * smoothstep(-0.2, 0.9, n) * 1.2;
    col += mix(uColorB, vec3(0.25, 0.45, 1.0) * length(uColorB), 0.5) * pow(max(n2, 0.0), 2.0) * 0.8;
    vec3 sp = floor(d * 220.0);
    float h = fract(sin(dot(sp, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    col += vec3(smoothstep(0.9975, 1.0, h)) * 0.8;
  }
  gl_FragColor = vec4(col * uIntensity, 1.0);
  #include <colorspace_fragment>
}
`;

export class EnvironmentRig {
  readonly root = new THREE.Group();
  private readonly ambient = new THREE.AmbientLight(0xffffff, 0.35);
  private readonly key = new THREE.DirectionalLight(0xffffff, 1.4);
  private readonly rim = new THREE.DirectionalLight(0xffffff, 1);
  private readonly fog = new THREE.FogExp2(0x000000, 0.02);
  private readonly bgMaterial: THREE.ShaderMaterial;
  private readonly bg: THREE.Mesh;
  private applied: Environment | null = null;

  constructor() {
    this.key.position.set(6, 8, 6);
    this.rim.position.set(-6, 3, -8);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.bgMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uMode: { value: 1 },
        uIntensity: { value: 1 },
        uTime: { value: 0 },
        uColorA: { value: new THREE.Color() },
        uColorB: { value: new THREE.Color() },
        uInvProj: { value: new THREE.Matrix4() },
        uCamWorld: { value: new THREE.Matrix4() },
      },
      vertexShader: BG_VERTEX,
      fragmentShader: BG_FRAGMENT,
      depthTest: false,
      depthWrite: false,
      fog: false,
    });
    this.bg = new THREE.Mesh(geometry, this.bgMaterial);
    this.bg.frustumCulled = false;
    this.bg.renderOrder = -1000;
    this.root.add(this.ambient, this.key, this.rim, this.bg);
  }

  apply(env: Environment, scene: THREE.Scene): void {
    if (env === this.applied) return;
    this.applied = env;
    const u = this.bgMaterial.uniforms;
    u.uMode.value = MODE_INDEX[env.background.mode];
    u.uIntensity.value = env.background.intensity;
    u.uColorA.value.set(env.background.colorA);
    u.uColorB.value.set(env.background.colorB);
    this.fog.color.set(env.fog.color);
    this.fog.density = env.fog.density;
    scene.fog = env.fog.enabled ? this.fog : null;
    scene.background = null;
    this.ambient.intensity = env.lighting.ambient;
    this.key.intensity = env.lighting.key;
    this.key.color.set(env.lighting.keyColor);
    this.rim.intensity = env.lighting.key * 0.9;
    this.rim.color.set(env.lighting.rimColor);
  }

  frame(camera: THREE.Camera, elapsed: number): void {
    const u = this.bgMaterial.uniforms;
    u.uTime.value = elapsed;
    u.uInvProj.value = camera.projectionMatrixInverse;
    u.uCamWorld.value = camera.matrixWorld;
  }

  dispose(scene: THREE.Scene): void {
    if (scene.fog === this.fog) scene.fog = null;
    this.bg.geometry.dispose();
    this.bgMaterial.dispose();
  }
}

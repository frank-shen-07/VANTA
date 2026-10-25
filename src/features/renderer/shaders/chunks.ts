/**
 * Hand-written GLSL chunks shared by the built-in layer shaders.
 * (Never generated from AI output.)
 */

/** Rotates a colour's hue by `turns` (YIQ rotation). */
export const HUE_SHIFT_GLSL = /* glsl */ `
vec3 vantaHueShift(vec3 color, float turns) {
  if (abs(turns) < 1e-4) return color;
  const mat3 toYIQ = mat3(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312);
  const mat3 toRGB = mat3(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703);
  vec3 yiq = toYIQ * color;
  float a = turns * 6.28318530718;
  float c = cos(a);
  float s = sin(a);
  yiq.yz = mat2(c, s, -s, c) * yiq.yz;
  return max(toRGB * yiq, 0.0);
}
`;

/** 3D simplex noise (Ashima Arts / Stefan Gustavson, MIT). */
export const SIMPLEX_GLSL = /* glsl */ `
vec3 vantaMod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 vantaMod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 vantaPermute(vec4 x) { return vantaMod289(((x * 34.0) + 1.0) * x); }
vec4 vantaTaylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float vantaSnoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = vantaMod289(i);
  vec4 p = vantaPermute(vantaPermute(vantaPermute(
            i.z + vec4(0.0, i1.z, i2.z, 1.0))
          + i.y + vec4(0.0, i1.y, i2.y, 1.0))
          + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = vantaTaylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
`;

/**
 * Exponential-squared fog that works for both blend modes: normal blending
 * mixes towards the fog colour, additive blending fades to black (adding the
 * fog colour would make distant objects glow). Requires fog_pars_* chunks.
 */
export const FOG_APPLY_GLSL = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float vantaFog = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
  #else
    float vantaFog = smoothstep(fogNear, fogFar, vFogDepth);
  #endif
  outColor = mix(outColor, fogColor, vantaFog * (1.0 - uAdditive));
  outAlpha *= 1.0 - vantaFog * uAdditive;
#endif
`;

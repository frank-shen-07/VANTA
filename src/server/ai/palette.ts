/** Small, dependency-free colour maths used by the scene generators. */

export interface Palette {
  primary: string;
  secondary: string;
  accent: string;
  bgA: string;
  bgB: string;
  fog: string;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** h in degrees 0..360, s/l 0..1 */
export function hexToHsl(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

export function hslToHex(h: number, s: number, l: number): string {
  const hue = (((h % 360) + 360) % 360) / 360;
  s = clamp01(s);
  l = clamp01(l);
  if (s === 0) return rgbToHex(l * 255, l * 255, l * 255);
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return rgbToHex(f(hue + 1 / 3) * 255, f(hue) * 255, f(hue - 1 / 3) * 255);
}

export function mixHex(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  const k = clamp01(t);
  return rgbToHex(r1 + (r2 - r1) * k, g1 + (g2 - g1) * k, b1 + (b2 - b1) * k);
}

export function shiftHue(hex: string, degrees: number): string {
  const [h, s, l] = hexToHsl(hex);
  return hslToHex(h + degrees, s, l);
}

/** Very dark tint of a colour for backgrounds / fog. */
export function deepTint(hex: string, lightness = 0.05, saturation = 0.6): string {
  const [h, s] = hexToHsl(hex);
  return hslToHex(h, Math.min(s, saturation), lightness);
}

export function hueDistance(a: string, b: string): number {
  const d = Math.abs(hexToHsl(a)[0] - hexToHsl(b)[0]) % 360;
  return d > 180 ? 360 - d : d;
}

export function isNeutral(hex: string): boolean {
  return hexToHsl(hex)[1] < 0.12;
}

/** Builds a harmonious palette around one to three seed colours. */
export function paletteFrom(primary: string, secondary: string, accent: string, bgHint?: string): Palette {
  const bgSeed = bgHint ?? (isNeutral(primary) ? "#0b0b10" : primary);
  return {
    primary,
    secondary,
    accent,
    bgA: deepTint(bgSeed, 0.025, 0.5),
    bgB: deepTint(mixHex(bgSeed, secondary, 0.35), 0.085, 0.55),
    fog: deepTint(bgSeed, 0.035, 0.45),
  };
}

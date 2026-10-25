/** Colour helpers shared by the sanitizer, inspector and renderer. */

const NAMED_COLORS: Record<string, string> = {
  black: "#000000",
  white: "#ffffff",
  red: "#ff2a3d",
  crimson: "#dc143c",
  orange: "#ff7a1a",
  amber: "#ffb000",
  gold: "#ffcc33",
  yellow: "#ffe04a",
  lime: "#9dff3a",
  green: "#22c55e",
  emerald: "#10b981",
  teal: "#14b8a6",
  cyan: "#22d3ee",
  aqua: "#00e5ff",
  sky: "#38bdf8",
  blue: "#3b82f6",
  indigo: "#6366f1",
  violet: "#8b5cf6",
  purple: "#a855f7",
  magenta: "#ff00cc",
  fuchsia: "#d946ef",
  pink: "#ff4fa3",
  rose: "#f43f5e",
  silver: "#c0c4cc",
  grey: "#808080",
  gray: "#808080",
};

/**
 * Normalises user/AI supplied colours to "#rrggbb" (lowercase).
 * Accepts "#rgb", "#rrggbb", "rrggbb", "rgb(r, g, b)" and a small set of names.
 * Returns null when the value cannot be interpreted.
 */
export function normalizeHexColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  if (NAMED_COLORS[v]) return NAMED_COLORS[v];
  let m = /^#?([0-9a-f]{6})$/.exec(v);
  if (m) return `#${m[1]}`;
  m = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(v);
  if (m) return `#${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}`;
  m = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/.exec(v);
  if (m) {
    const hex = [m[1], m[2], m[3]]
      .map((c) => Math.min(255, Number(c)).toString(16).padStart(2, "0"))
      .join("");
    return `#${hex}`;
  }
  return null;
}

/**
 * Deterministic, keyword-based scene generator. Used when no LLM is configured
 * or when the LLM fails / refuses / returns unusable output. It never claims to
 * understand emotion; it maps words and measured music features to styling.
 */
import type { AudioProfile } from "@/shared/audio/contract";
import { createLayer, createMapping, createScene } from "@/shared/scene/defaults";
import { LAYER_TYPE_INFO, layerSupportsTarget } from "@/shared/scene/layers";
import type { ScenePatch, ScenePatchOp } from "@/shared/scene/patch";
import { PRESETS, getPreset } from "@/shared/scene/presets";
import { sanitizeSceneConfig } from "@/shared/scene/sanitize";
import { LIMITS, type AudioBand, type AudioMapping, type Layer, type LayerOfType, type LayerType, type MappingTarget, type SceneConfig } from "@/shared/scene/schema";
import { hexToHsl, hslToHex, hueDistance, mixHex, paletteFrom, shiftHue, type Palette } from "./palette";
import { WordSet, titleCase } from "./text";

/* ------------------------------------------------------------------ */
/* Vocabulary                                                          */
/* ------------------------------------------------------------------ */

interface Theme {
  id: string;
  words: string[];
  primary: string;
  secondary: string;
  accent: string;
  bg?: string;
  label: string;
}

const THEMES: Theme[] = [
  { id: "cyberpunk", label: "Cyberpunk", words: ["cyberpunk", "cyber", "blade runner", "dystopian", "hacker", "matrix"], primary: "#ff2e88", secondary: "#22d3ee", accent: "#7c3aed" },
  { id: "vaporwave", label: "Vaporwave", words: ["vaporwave", "vapor", "aesthetic"], primary: "#ff71ce", secondary: "#01cdfe", accent: "#b967ff" },
  { id: "synthwave", label: "Synthwave", words: ["synthwave", "outrun", "retro", "80s", "retrowave"], primary: "#ff3cac", secondary: "#ffb000", accent: "#8be9ff" },
  { id: "neon", label: "Neon", words: ["neon", "rave", "club", "laser", "lasers"], primary: "#ff2e88", secondary: "#22d3ee", accent: "#a855f7" },
  { id: "sunset", label: "Sunset", words: ["sunset", "dusk", "sunrise", "dawn", "golden hour", "evening"], primary: "#ff7a1a", secondary: "#ff3c6e", accent: "#ffb000" },
  { id: "ocean", label: "Ocean", words: ["ocean", "sea", "underwater", "deep sea", "aquatic", "wave", "marine", "abyss"], primary: "#0ea5e9", secondary: "#14b8a6", accent: "#67e8f9", bg: "#031526" },
  { id: "ice", label: "Ice", words: ["ice", "icy", "frozen", "arctic", "winter", "glacier", "frost", "snow", "cold"], primary: "#a5f3fc", secondary: "#60a5fa", accent: "#e0f2fe", bg: "#06142a" },
  { id: "fire", label: "Inferno", words: ["fire", "flame", "flames", "lava", "inferno", "volcano", "volcanic", "ember", "embers", "burning", "hell"], primary: "#ff4d00", secondary: "#ffb000", accent: "#ff1a1a" },
  { id: "forest", label: "Forest", words: ["forest", "jungle", "nature", "organic", "moss", "woods", "leaf", "leaves", "garden"], primary: "#22c55e", secondary: "#a3e635", accent: "#10b981" },
  { id: "toxic", label: "Toxic", words: ["toxic", "acid", "radioactive", "slime", "poison"], primary: "#9dff3a", secondary: "#39ff14", accent: "#d9ff00" },
  { id: "aurora", label: "Aurora", words: ["aurora", "northern lights", "borealis"], primary: "#34d399", secondary: "#22d3ee", accent: "#a78bfa" },
  { id: "gold", label: "Golden", words: ["gold", "golden", "luxury", "royal", "regal", "treasure"], primary: "#ffcc33", secondary: "#ff9f1a", accent: "#fff1b8" },
  { id: "space", label: "Cosmic", words: ["space", "galaxy", "cosmic", "cosmos", "nebula", "universe", "stars", "starfield", "astral", "celestial", "interstellar"], primary: "#a78bfa", secondary: "#38bdf8", accent: "#f0abfc" },
  { id: "mono", label: "Monochrome", words: ["monochrome", "black and white", "grayscale", "greyscale", "noir", "mono"], primary: "#f5f5f5", secondary: "#9ca3af", accent: "#ffffff", bg: "#0a0a0a" },
  { id: "dark", label: "Dark", words: ["dark", "moody", "gothic", "industrial", "brutal", "techno"], primary: "#8b5cf6", secondary: "#e11d48", accent: "#64748b", bg: "#08070c" },
];

const COLOR_WORDS: Record<string, string> = {
  red: "#ff1f3d",
  crimson: "#dc143c",
  scarlet: "#ff2400",
  blood: "#b3001b",
  orange: "#ff7a1a",
  amber: "#ffb000",
  yellow: "#ffe04a",
  gold: "#ffcc33",
  golden: "#ffcc33",
  lime: "#9dff3a",
  green: "#22c55e",
  emerald: "#10b981",
  mint: "#5eead4",
  teal: "#14b8a6",
  turquoise: "#2dd4bf",
  cyan: "#22d3ee",
  aqua: "#00e5ff",
  blue: "#3b82f6",
  azure: "#38bdf8",
  navy: "#1e3a8a",
  cobalt: "#0047ab",
  indigo: "#6366f1",
  violet: "#8b5cf6",
  purple: "#a855f7",
  lavender: "#c4b5fd",
  magenta: "#ff00cc",
  fuchsia: "#d946ef",
  pink: "#ff4fa3",
  rose: "#f43f5e",
  white: "#f5f5f5",
  silver: "#c0c4cc",
  chrome: "#d4d8e0",
};

const LAYER_WORDS: Record<LayerType, string[]> = {
  tunnel: ["tunnel", "tunnels", "corridor", "wormhole", "warp", "hyperspace", "vortex", "tube", "passage"],
  rings: ["ring", "rings", "halo", "halos", "circle", "circles", "portal", "portals", "loop", "loops", "hoop", "hoops"],
  particles: ["particle", "particles", "dust", "star", "stars", "starfield", "galaxy", "galaxies", "sparkle", "sparkles", "snow", "ember", "embers", "firefly", "fireflies", "rain", "swarm", "spark", "sparks", "nebula", "cloud", "bokeh", "glitter"],
  shape: ["crystal", "crystals", "gem", "gems", "diamond", "shape", "shapes", "sphere", "spheres", "orb", "orbs", "cube", "cubes", "box", "torus", "donut", "knot", "pyramid", "tetrahedron", "octahedron", "icosahedron", "dodecahedron", "polyhedron", "geometry", "geometric", "monolith", "planet", "planets", "sun", "moon", "shard", "shards", "core", "blob"],
  grid: ["grid", "horizon", "floor", "terrain", "landscape", "ground", "plane", "mountains", "synthwave", "outrun"],
  spectrum: ["spectrum", "bars", "bar", "equalizer", "equaliser", "eq", "visualizer", "visualiser", "waveform", "frequency", "frequencies", "analyzer", "analyser"],
};

const STRONG_WORDS = ["strong", "strongly", "intense", "intensely", "aggressive", "aggressively", "hard", "heavy", "heavily", "punchy", "extreme", "violent", "violently", "explosive", "massive", "pounding", "wild", "crazy", "insane", "energetic", "powerful", "maximum", "brutal", "hyper", "chaotic", "banging"];
const SUBTLE_WORDS = ["subtle", "subtly", "calm", "gentle", "gently", "soft", "softly", "chill", "relaxed", "relaxing", "ambient", "peaceful", "serene", "smooth", "minimal", "delicate", "dreamy", "mellow", "lofi", "lo-fi", "quiet", "meditative", "slight", "slightly"];
const FAST_WORDS = ["fast", "faster", "rapid", "racing", "speed", "speedy", "frantic", "quick", "hyperspeed", "rushing", "zooming", "high-speed"];
const SLOW_WORDS = ["slow", "slowly", "drifting", "drift", "floating", "lazy", "languid", "still", "glacial", "hypnotic"];
const BASS_WORDS = ["bass", "kick", "kicks", "sub", "subs", "808", "808s", "low", "lows", "low-end", "drop", "drops", "boom"];
const HIGH_WORDS = ["treble", "hats", "hi-hats", "hihats", "hihat", "highs", "high-end", "cymbals", "shimmer", "shimmering", "snare", "snares"];
const MID_WORDS = ["vocals", "vocal", "voice", "mids", "melody", "melodic", "synth", "synths", "guitar", "piano", "chords", "lead"];
const BEAT_WORDS = ["beat", "beats", "rhythm", "rhythmic", "drums", "drum", "percussion", "transients", "onset", "onsets", "pulse", "pulsing", "pulsating", "throbbing"];

/* ------------------------------------------------------------------ */
/* Prompt analysis                                                     */
/* ------------------------------------------------------------------ */

export interface PromptTraits {
  words: WordSet;
  theme: Theme | null;
  colors: string[];
  palette: Palette;
  layerTypes: LayerType[];
  intensity: number;
  intensityLabel: "strong" | "subtle" | "balanced";
  speed: number;
  band: AudioBand;
  bandExplicit: boolean;
  pulsing: boolean;
  glowing: boolean;
  preset: string | null;
}

function findColors(words: WordSet): string[] {
  const found: { index: number; hex: string }[] = [];
  for (const [word, hex] of Object.entries(COLOR_WORDS)) {
    const i = words.indexOf(word);
    if (i >= 0) found.push({ index: i, hex });
  }
  return found.sort((a, b) => a.index - b.index).map((f) => f.hex);
}

function buildPalette(colors: string[], theme: Theme | null): Palette {
  const base = theme ?? { primary: "#8b5cf6", secondary: "#22d3ee", accent: "#ff2e88", bg: undefined };
  if (colors.length === 0) return paletteFrom(base.primary, base.secondary, base.accent, theme?.bg);
  const primary = colors[0];
  let secondary = colors[1];
  if (!secondary) secondary = hueDistance(primary, base.primary) >= 15 ? base.primary : base.secondary;
  let accent = colors[2] ?? (secondary === base.secondary ? base.accent : base.secondary);
  if (hueDistance(accent, primary) < 10) accent = shiftHue(primary, 180);
  return paletteFrom(primary, secondary, accent, theme?.bg);
}

export function analyzePrompt(prompt: string, profile?: AudioProfile | null): PromptTraits {
  const words = new WordSet(prompt);
  let theme: Theme | null = null;
  let bestThemeIndex = Infinity;
  for (const t of THEMES) {
    const i = t.words.reduce((best, w) => {
      const idx = w.includes(" ") ? (words.has(w) ? 0 : -1) : words.indexOf(w);
      return idx >= 0 && (best < 0 || idx < best) ? idx : best;
    }, -1);
    if (i >= 0 && i < bestThemeIndex) {
      theme = t;
      bestThemeIndex = i;
    }
  }
  const colors = findColors(words);
  const layerTypes = (Object.keys(LAYER_WORDS) as LayerType[])
    .map((type) => ({ type, index: words.indexOf(...LAYER_WORDS[type]) }))
    .filter((e) => e.index >= 0)
    .sort((a, b) => a.index - b.index)
    .map((e) => e.type);

  const strong = words.count(...STRONG_WORDS);
  const subtle = words.count(...SUBTLE_WORDS);
  let intensity = strong > subtle ? 1.6 : subtle > strong ? 0.55 : 1;
  let speed = words.has(...FAST_WORDS) ? 1.6 : words.has(...SLOW_WORDS) ? 0.5 : 1;

  let band: AudioBand = "bass";
  let bandExplicit = true;
  const bassI = words.indexOf(...BASS_WORDS);
  const highI = words.indexOf(...HIGH_WORDS);
  const midI = words.indexOf(...MID_WORDS);
  const candidates = [
    { band: "bass" as const, i: bassI },
    { band: "highs" as const, i: highI },
    { band: "mids" as const, i: midI },
  ].filter((c) => c.i >= 0);
  if (candidates.length > 0) band = candidates.sort((a, b) => a.i - b.i)[0].band;
  else bandExplicit = false;

  // Measured music features gently shape defaults when the prompt is silent.
  if (profile) {
    if (!bandExplicit) {
      if (profile.bassRatio >= 0.45) band = "bass";
      else if (profile.highsRatio >= 0.35) band = "highs";
      else if (profile.midsRatio >= 0.45) band = "mids";
    }
    if (speed === 1 && profile.tempoBpm != null) speed = profile.tempoBpm >= 125 ? 1.3 : profile.tempoBpm <= 90 ? 0.7 : 1;
    if (strong === 0 && subtle === 0) intensity = profile.avgEnergy >= 0.55 || profile.dynamics >= 0.65 ? 1.25 : profile.avgEnergy <= 0.2 ? 0.75 : 1;
  }

  // Preset with the most matching tags (ties → earliest in PRESETS).
  let preset: string | null = null;
  let bestScore = 0;
  for (const p of PRESETS) {
    const score = p.tags.filter((t) => words.has(t)).length;
    if (score > bestScore) {
      bestScore = score;
      preset = p.id;
    }
  }

  return {
    words,
    theme,
    colors,
    palette: buildPalette(colors, theme),
    layerTypes,
    intensity,
    intensityLabel: intensity > 1.2 ? "strong" : intensity < 0.8 ? "subtle" : "balanced",
    speed,
    band,
    bandExplicit,
    pulsing: words.has(...BEAT_WORDS),
    glowing: words.has("glow", "glowing", "glows", "luminous", "bright", "radiant", "shining", "shiny", "bloom"),
    preset,
  };
}

/* ------------------------------------------------------------------ */
/* Layer builders                                                      */
/* ------------------------------------------------------------------ */

const r2 = (v: number) => Math.round(v * 100) / 100;
const clampAmount = (v: number) => r2(Math.max(-3, Math.min(3, v)));

function m(source: AudioBand, target: MappingTarget, amount: number, extra: Partial<AudioMapping> = {}): AudioMapping {
  return createMapping({ source, target, amount: clampAmount(amount), ...extra });
}

function mappingsFor(type: LayerType, t: PromptTraits): AudioMapping[] {
  const I = t.intensity;
  const B = t.band;
  const secondary: AudioBand = B === "highs" ? "bass" : "highs";
  let list: AudioMapping[];
  switch (type) {
    case "tunnel":
      list = [m(B, "brightness", 0.9 * I), m(B === "bass" ? "energy" : B, "speed", 1.1 * I), ...(t.pulsing ? [m("onset", "displacement", 0.5 * I, { smoothing: 0.35 })] : [])];
      break;
    case "rings":
      list = [m(B, "scale", 0.4 * I, { threshold: 0.1 }), t.pulsing ? m("onset", "brightness", 1.2 * I, { smoothing: 0.4 }) : m("energy", "brightness", 0.9 * I)];
      break;
    case "particles":
      list = [m(B, "displacement", 0.8 * I), m(B, "speed", 0.9 * I), m(secondary, "brightness", 0.6 * Math.max(0.8, I))];
      break;
    case "shape":
      list = [m(B, "scale", 0.35 * I), m(B === "mids" ? "bass" : "mids", "displacement", 0.6 * I), ...(t.pulsing ? [m("onset", "bounce", 0.4 * I)] : [])];
      break;
    case "grid":
      list = [m(B, "displacement", 1.0 * I), m("energy", "speed", 0.8 * I)];
      break;
    case "spectrum":
      list = [m("onset", "brightness", 0.8 * I, { smoothing: 0.5 }), m(B, "scale", 0.3 * I)];
      break;
  }
  return list.filter((x) => layerSupportsTarget(type, x.target)).slice(0, LIMITS.maxMappingsPerLayer);
}

function shapeGeometry(words: WordSet): LayerOfType<"shape">["shape"]["geometry"] {
  if (words.has("crystal", "gem", "diamond", "shard", "shards")) return "octahedron";
  if (words.has("torus", "donut", "ring-shaped")) return "torus";
  if (words.has("knot")) return "torusKnot";
  if (words.has("cube", "box", "cubes")) return "box";
  if (words.has("pyramid", "tetrahedron")) return "tetrahedron";
  if (words.has("dodecahedron")) return "dodecahedron";
  if (words.has("sphere", "orb", "planet", "sun", "moon", "blob")) return "sphere";
  return "icosahedron";
}

function particleDistribution(t: PromptTraits, hasTunnel: boolean): LayerOfType<"particles">["particles"]["distribution"] {
  const w = t.words;
  if (w.has("galaxy", "spiral", "vortex", "swirl")) return "spiral";
  if (w.has("stars", "starfield", "star", "constellation")) return "shell";
  if (w.has("snow", "rain", "falling")) return "cube";
  if (w.has("disc", "disk", "ring-shaped", "accretion")) return "disc";
  if (hasTunnel) return "tunnel";
  return "sphere";
}

function buildLayer(type: LayerType, t: PromptTraits, ctx: { hasTunnel: boolean; index: number }): Layer {
  const p = t.palette;
  const glowBoost = t.glowing ? 1.35 : 1;
  const speed = r2(Math.max(0.1, Math.min(5, t.speed)));
  const template = t.preset ? getPreset(t.preset)?.create().layers.find((l) => l.type === type) : undefined;
  let layer: Layer;
  switch (type) {
    case "tunnel": {
      const base = template?.type === "tunnel" ? template.tunnel : undefined;
      layer = createLayer("tunnel", {
        name: `${t.theme?.label ?? "Neon"} Tunnel`,
        glow: r2(1.6 * glowBoost),
        tunnel: { ...base, colorA: p.primary, colorB: p.secondary, radius: base?.radius ?? 7, sides: t.words.has("round", "circular", "smooth") ? 32 : (base?.sides ?? 8), twist: t.words.has("twist", "twisted", "twisting", "spiral") ? 0.6 : (base?.twist ?? 0.2), wireframe: !t.words.has("solid") },
        motion: { spin: [0, 0, r2(0.05 * speed)], speed },
      });
      break;
    }
    case "rings": {
      const inTunnel = ctx.hasTunnel || t.words.has("tunnel");
      layer = createLayer("rings", {
        name: t.pulsing ? "Pulse Rings" : "Neon Rings",
        glow: r2(2 * glowBoost),
        rings: {
          arrangement: inTunnel ? "tunnel" : t.words.has("orbit", "orbiting") ? "orbit" : "concentric",
          count: inTunnel ? 18 : 6,
          radius: inTunnel ? 4.5 : 3,
          spacing: inTunnel ? 4 : 0.7,
          sides: t.words.has("hexagon", "hexagonal", "hex") ? 6 : t.words.has("triangle", "triangular") ? 3 : t.words.has("square", "squares") ? 4 : inTunnel ? 6 : 64,
          thickness: 0.05,
          colorA: p.secondary,
          colorB: p.primary,
          wave: t.intensity > 1.2 ? 0.7 : 0.4,
        },
        motion: { spin: [0, 0, r2(0.15 * speed)], speed },
      });
      break;
    }
    case "particles": {
      const distribution = particleDistribution(t, ctx.hasTunnel);
      layer = createLayer("particles", {
        name: distribution === "spiral" ? "Galaxy" : distribution === "shell" ? "Star Field" : t.words.has("dust") ? "Dust" : t.glowing ? "Glow Particles" : "Particle Field",
        glow: r2(1.4 * glowBoost),
        particles: {
          distribution,
          count: distribution === "spiral" ? 18000 : distribution === "shell" ? 5000 : 9000,
          spread: distribution === "tunnel" ? 6 : distribution === "shell" ? 36 : 14,
          size: distribution === "shell" ? 0.07 : 0.05,
          colorA: mixHex(p.primary, "#ffffff", 0.25),
          colorB: p.accent,
          turbulence: t.intensity > 1.2 ? 1 : 0.5,
          twinkle: t.words.has("twinkle", "twinkling", "sparkle", "sparkles", "stars") ? 0.85 : 0.4,
        },
        motion: { spin: [0, r2(0.06 * speed), 0], speed },
      });
      break;
    }
    case "shape": {
      const geometry = shapeGeometry(t.words);
      const many = t.words.has("shards", "crystals", "orbs", "cubes", "planets", "spheres", "gems", "shapes");
      const [h] = hexToHsl(p.primary);
      layer = createLayer("shape", {
        name: titleCase(geometry === "octahedron" ? "crystal" : geometry === "torusKnot" ? "knot" : geometry),
        glow: r2(0.8 * glowBoost),
        shape: {
          geometry,
          detail: geometry === "sphere" ? 3 : 1,
          instances: many ? 8 : 1,
          orbitRadius: many ? 6 : 0,
          color: hslToHex(h, 0.35, 0.1),
          emissive: p.primary,
          wireframe: t.words.has("wireframe", "wire"),
          distortion: t.words.has("liquid", "organic", "morphing", "blob", "melting") ? 0.7 : 0.3,
        },
        transform: { scale: many ? 0.6 : 2 },
        motion: { spin: [r2(0.15 * speed), r2(0.3 * speed), 0], speed },
      });
      break;
    }
    case "grid":
      layer = createLayer("grid", {
        name: "Horizon Grid",
        glow: r2(1.4 * glowBoost),
        grid: { color: p.primary, wave: t.intensity > 1.2 ? 2 : 1.2, divisions: 72 },
        transform: { position: [0, -3, 0] },
        motion: { spin: [0, 0, 0], speed },
      });
      break;
    case "spectrum":
      layer = createLayer("spectrum", {
        name: "Spectrum",
        glow: r2(1.6 * glowBoost),
        spectrum: { layout: t.words.has("line", "linear", "flat") ? "line" : "circle", bars: 96, radius: 4.5, maxHeight: t.intensity > 1.2 ? 6 : 4, colorA: p.primary, colorB: p.secondary },
        motion: { spin: [0, 0, 0], speed },
      });
      break;
  }
  layer.reactivity = mappingsFor(type, t);
  return layer;
}

const DRAW_ORDER: LayerType[] = ["grid", "tunnel", "particles", "rings", "shape", "spectrum"];

function chooseLayerTypes(t: PromptTraits): LayerType[] {
  let types = [...t.layerTypes];
  if (types.length === 0) {
    const preset = t.preset ? getPreset(t.preset) : undefined;
    types = preset ? [...new Set(preset.create().layers.map((l) => l.type))] : t.intensity < 0.8 ? ["particles", "shape"] : ["particles", "rings", "shape"];
  }
  // Depth: a lone layer gets an atmospheric particle field.
  if (types.length === 1) types.push(types[0] === "particles" ? (t.intensity < 0.8 ? "rings" : "shape") : "particles");
  return DRAW_ORDER.filter((d) => types.includes(d)).slice(0, 5);
}

/* ------------------------------------------------------------------ */
/* Generate                                                            */
/* ------------------------------------------------------------------ */

export interface HeuristicSceneResult {
  scene: SceneConfig;
  summary: string;
  warnings: string[];
}

function listJoin(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function colorName(hex: string): string {
  const [h, s, l] = hexToHsl(hex);
  if (s < 0.15) return l > 0.6 ? "white" : "grey";
  const names: [number, string][] = [[15, "red"], [40, "orange"], [65, "gold"], [90, "lime"], [160, "green"], [195, "cyan"], [240, "blue"], [275, "violet"], [300, "purple"], [335, "magenta"], [361, "red"]];
  return names.find(([max]) => h < max)?.[1] ?? "neon";
}

export function generateHeuristicScene(prompt: string, profile?: AudioProfile | null): HeuristicSceneResult {
  const t = analyzePrompt(prompt, profile);
  const types = chooseLayerTypes(t);
  const hasTunnel = types.includes("tunnel");
  const layers = types.map((type, index) => buildLayer(type, t, { hasTunnel, index }));
  const p = t.palette;
  const I = t.intensity;

  const mainType = t.layerTypes[0] ?? types.find((x) => x !== "particles") ?? types[0];
  const adjective = t.colors.length > 0 ? titleCase(Object.entries(COLOR_WORDS).find(([, hex]) => hex === t.colors[0])?.[0] ?? colorName(p.primary)) : "";
  const nameParts = [adjective, t.theme?.label ?? "", LAYER_TYPE_INFO[mainType].label === "Shape" ? titleCase(layers.find((l) => l.type === "shape")?.name ?? "Core") : LAYER_TYPE_INFO[mainType].label];
  const name = nameParts.filter(Boolean).join(" ").replace(/\s+/g, " ").slice(0, LIMITS.maxNameLength) || "Generated Scene";

  const scene = createScene({
    name,
    preset: t.preset ?? "custom",
    origin: "heuristic",
    prompt: prompt.slice(0, LIMITS.maxPromptLength),
    layers,
    environment: {
      background: { mode: t.theme?.id === "space" || t.words.has("nebula", "galaxy", "cosmic") ? "nebula" : "gradient", colorA: p.bgA, colorB: p.bgB, intensity: 1 },
      fog: { enabled: !t.words.has("clear", "no fog"), color: p.fog, density: hasTunnel ? 0.03 : t.words.has("fog", "foggy", "mist", "misty", "haze", "hazy") ? 0.05 : 0.02 },
      lighting: { ambient: 0.35, key: 1.4, keyColor: mixHex(p.primary, "#ffffff", 0.5), rimColor: p.secondary },
      camera: {
        fov: hasTunnel ? 70 : 55,
        distance: hasTunnel ? 6 : types.includes("grid") ? 16 : 14,
        height: types.includes("grid") ? 2.5 : hasTunnel ? 0 : 1.5,
        autoRotate: !hasTunnel && !types.includes("grid"),
        autoRotateSpeed: r2(0.4 * t.speed),
        shake: r2(Math.min(1, 0.15 * I + (t.pulsing ? 0.1 : 0))),
      },
    },
    post: {
      bloom: { enabled: true, intensity: r2(Math.min(4, (t.glowing ? 1.7 : 1.3) * (I > 1.2 ? 1.15 : 1))), threshold: 0.18, radius: 0.7, audioBoost: r2(Math.min(3, 0.8 * I)) },
      chromaticAberration: t.theme?.id === "cyberpunk" || t.words.has("glitch", "glitchy") ? 0.35 : 0.15,
      vignette: t.words.has("dark", "moody", "cinematic") ? 0.65 : 0.45,
      noise: t.words.has("grain", "grainy", "film", "vhs", "lofi", "lo-fi") ? 0.25 : 0.08,
    },
    audio: { sensitivity: r2(Math.min(3, I > 1.2 ? 1.3 : I < 0.8 ? 0.75 : 1)), smoothing: I < 0.8 ? 0.72 : I > 1.2 ? 0.45 : 0.55 },
  });

  const result = sanitizeSceneConfig(scene);
  const reactWord = t.intensityLabel === "strong" ? "strong" : t.intensityLabel === "subtle" ? "gentle" : "balanced";
  const bandWord = t.band === "bass" ? "bass" : t.band === "highs" ? "high frequencies" : "mid-range";
  const summary = `Built "${result.value.name}": ${listJoin(layers.map((l) => l.name.toLowerCase()))} in ${colorName(p.primary)}/${colorName(p.secondary)} tones with ${reactWord} reactions to the ${bandWord}.`;
  return { scene: result.value, summary: summary.slice(0, 600), warnings: result.warnings };
}

/* ------------------------------------------------------------------ */
/* Refine                                                              */
/* ------------------------------------------------------------------ */

export interface HeuristicPatchResult {
  patch: ScenePatch;
  summary: string;
  warnings: string[];
}

const COLOR_FIELDS: Record<LayerType, string[]> = {
  particles: ["colorA", "colorB"],
  rings: ["colorA", "colorB"],
  shape: ["emissive"],
  tunnel: ["colorA", "colorB"],
  grid: ["color"],
  spectrum: ["colorA", "colorB"],
};

function layerColors(layer: Layer): Record<string, string> {
  const body = (layer as unknown as Record<string, Record<string, unknown>>)[layer.type];
  return Object.fromEntries(COLOR_FIELDS[layer.type].map((k) => [k, String(body[k])]));
}

function targetLayers(scene: SceneConfig, words: WordSet, selectedLayerId: string | null | undefined): { layers: Layer[]; explicit: boolean } {
  const byType = scene.layers.filter((l) => words.has(...LAYER_WORDS[l.type].filter((w) => !["core", "sun", "moon", "cloud", "drop"].includes(w))));
  const byName = scene.layers.filter((l) => l.name.toLowerCase().split(/\s+/).some((w) => w.length >= 4 && words.has(w)));
  // An explicit type ("the rings") wins over incidental name matches ("Glow Particles" for "more glow").
  const explicit = byType.length > 0 ? byType : byName;
  if (explicit.length > 0) return { layers: explicit, explicit: true };
  if (words.has("everything", "all", "scene", "whole", "entire", "overall")) return { layers: scene.layers, explicit: false };
  const selected = scene.layers.find((l) => l.id === selectedLayerId);
  if (selected && words.has("this", "it", "selected", "layer")) return { layers: [selected], explicit: true };
  if (selected) return { layers: [selected], explicit: false };
  return { layers: scene.layers, explicit: false };
}

export function refineHeuristicScene(prompt: string, scene: SceneConfig, selectedLayerId?: string | null): HeuristicPatchResult {
  const words = new WordSet(prompt);
  const ops: ScenePatchOp[] = [];
  const notes: string[] = [];
  const warnings: string[] = [];
  const { layers: targets } = targetLayers(scene, words, selectedLayerId);
  const layerChanges = new Map<string, Record<string, unknown>>();
  const change = (layer: Layer, patch: Record<string, unknown>) => {
    const current = layerChanges.get(layer.id) ?? {};
    for (const [k, v] of Object.entries(patch)) {
      const prev = current[k];
      current[k] = prev && typeof prev === "object" && !Array.isArray(prev) && v && typeof v === "object" && !Array.isArray(v) ? { ...prev, ...v } : v;
    }
    layerChanges.set(layer.id, current);
  };
  const more = words.has("more", "increase", "boost", "stronger", "higher", "extra", "intensify", "amplify", "crank", "up");
  const less = words.has("less", "decrease", "reduce", "lower", "weaker", "fewer", "tone down", "softer", "subtler", "down", "dial back");
  const removeIntent = words.has("remove", "delete", "without", "drop", "get rid", "no more", "kill", "lose");
  const addIntent = words.has("add", "include", "insert", "spawn", "create", "put", "introduce", "plus") && !removeIntent;

  // Add / remove layers by type.
  const mentioned = (Object.keys(LAYER_WORDS) as LayerType[]).filter((type) => words.has(...LAYER_WORDS[type].filter((w) => !["core", "sun", "moon", "cloud", "drop", "low"].includes(w))));
  if (removeIntent) {
    for (const type of mentioned) {
      const victims = scene.layers.filter((l) => l.type === type);
      victims.forEach((l) => ops.push({ op: "removeLayer", layerId: l.id }));
      if (victims.length) notes.push(`removed ${victims.length > 1 ? `${victims.length} ${type} layers` : `the ${victims[0].name} layer`}`);
    }
  } else if (addIntent || (more && mentioned.length > 0 && mentioned.some((type) => !scene.layers.some((l) => l.type === type)))) {
    const traits = analyzePrompt(prompt);
    // Reuse the scene's existing colours so the new layer fits in.
    const ref = scene.layers[0] ? Object.values(layerColors(scene.layers[0])) : [];
    if (traits.colors.length === 0 && ref.length) traits.palette = paletteFrom(ref[0], ref[1] ?? shiftHue(ref[0], 40), shiftHue(ref[0], 180));
    const hasTunnel = scene.layers.some((l) => l.type === "tunnel");
    for (const type of mentioned) {
      if (!addIntent && scene.layers.some((l) => l.type === type)) continue;
      if (scene.layers.length + ops.filter((o) => o.op === "addLayer").length >= LIMITS.maxLayers) {
        warnings.push(`Layer limit (${LIMITS.maxLayers}) reached; could not add ${type}.`);
        break;
      }
      const layer = buildLayer(type, traits, { hasTunnel, index: scene.layers.length });
      ops.push({ op: "addLayer", layer: layer as unknown as Record<string, unknown> });
      notes.push(`added a ${LAYER_TYPE_INFO[type].label.toLowerCase()} layer`);
    }
  }
  const removedIds = new Set(ops.filter((o) => o.op === "removeLayer").map((o) => (o as { layerId: string }).layerId));
  const addedTypes = new Set(ops.filter((o) => o.op === "addLayer").map((o) => (o as unknown as { layer: { type: LayerType } }).layer.type));
  const editable = targets.filter((l) => !removedIds.has(l.id) && !(addedTypes.has(l.type) && addIntent));

  // Colours: "more red", "make it blue", "warmer", "cooler".
  const colorHex = findColors(words)[0] ?? (words.has("warmer", "warm") ? "#ff7a1a" : words.has("cooler", "cool", "colder") ? "#22d3ee" : null);
  if (colorHex && editable.length > 0) {
    const blend = more || words.has("bit", "slightly", "tint", "touch", "warmer", "cooler", "warm", "cool") ? 0.5 : 0.85;
    for (const layer of editable) {
      const colors = layerColors(layer);
      const body: Record<string, string> = {};
      Object.entries(colors).forEach(([k, v], i) => (body[k] = mixHex(v, i === 0 ? colorHex : shiftHue(colorHex, 25), i === 0 ? blend : blend * 0.7)));
      change(layer, { [layer.type]: body });
    }
    notes.push(`shifted colours towards ${colorName(colorHex)}`);
  }

  const factor = (up: number, down: number) => (less && !more ? down : up);
  // Speed.
  if (words.has("faster", "speed up", "quicker", "accelerate", "rapid") || (words.has("slower", "slow down", "calmer", "slowly") && !words.has("faster"))) {
    const k = words.has("slower", "slow down", "calmer", "slowly") ? 0.6 : 1.5;
    for (const layer of editable) change(layer, { motion: { speed: r2(Math.min(5, Math.max(0.05, layer.motion.speed * k))), spin: layer.motion.spin.map((s) => r2(Math.max(-3, Math.min(3, s * k)))) } });
    notes.push(k > 1 ? "sped up the motion" : "slowed the motion down");
  }
  // Size.
  if (words.has("bigger", "larger", "huge", "giant", "enlarge", "grow", "scale up") || words.has("smaller", "tiny", "shrink", "scale down", "little")) {
    const k = words.has("smaller", "tiny", "shrink", "scale down", "little") ? 0.7 : 1.35;
    for (const layer of editable) change(layer, { transform: { scale: r2(Math.min(10, Math.max(0.05, layer.transform.scale * k))) } });
    notes.push(k > 1 ? "made it bigger" : "made it smaller");
  }
  // Glow / bloom.
  if (words.has("glow", "glowing", "glowier", "bloom", "brighter", "brightness", "dimmer", "darker", "luminous")) {
    const k = words.has("dimmer", "darker") || less ? 0.65 : 1.4;
    for (const layer of editable) change(layer, { glow: r2(Math.min(5, Math.max(0, layer.glow * k))) });
    ops.push({ op: "updatePost", changes: { bloom: { enabled: true, intensity: r2(Math.min(4, Math.max(0, scene.post.bloom.intensity * k))) } } });
    notes.push(k > 1 ? "boosted the glow and bloom" : "toned the glow down");
  }
  // Camera shake.
  if (words.has("shake", "shaking", "shakier", "shaky", "stable", "steady", "stabilize")) {
    const off = words.has("no shake", "stable", "steady", "stabilize", "stop shaking") || (less && !more);
    const shake = off ? r2(words.has("no shake", "stop shaking") ? 0 : scene.environment.camera.shake * 0.4) : r2(Math.min(1, scene.environment.camera.shake + 0.25));
    ops.push({ op: "updateEnvironment", changes: { camera: { shake } } });
    notes.push(off ? "calmed the camera shake" : "added more camera shake");
  }
  // Fog.
  if (words.has("fog", "foggy", "mist", "misty", "haze", "hazy")) {
    const off = words.has("no fog", "clear", "without") || (less && !more);
    ops.push({ op: "updateEnvironment", changes: { fog: off ? { density: r2(scene.environment.fog.density * 0.4) } : { enabled: true, density: Math.min(0.15, Math.round(Math.max(0.03, scene.environment.fog.density * 1.7) * 1000) / 1000) } } });
    notes.push(off ? "thinned the fog" : "thickened the fog");
  }
  // Camera distance.
  if (words.has("zoom in", "closer", "zoom out", "further", "farther", "wider")) {
    const k = words.has("zoom in", "closer") ? 0.75 : 1.35;
    ops.push({ op: "updateEnvironment", changes: { camera: { distance: r2(Math.min(120, Math.max(1, scene.environment.camera.distance * k))) } } });
    notes.push(k < 1 ? "moved the camera closer" : "pulled the camera back");
  }
  // Spin.
  if (words.has("spin", "spinning", "rotate", "rotating", "rotation", "twirl")) {
    const stop = words.has("stop", "no", "without", "freeze");
    const k = stop ? 0 : factor(1.7, 0.5);
    for (const layer of editable) {
      const spin = layer.motion.spin.some((s) => s !== 0) || stop ? layer.motion.spin : ([0, 0.2, 0] as const);
      change(layer, { motion: { spin: spin.map((s) => r2(Math.max(-3, Math.min(3, s * (stop ? 0 : k || 1))))) } });
    }
    notes.push(stop ? "stopped the spin" : k > 1 ? "increased the spin" : "reduced the spin");
  }
  // Wireframe / solid.
  if (words.has("wireframe", "solid")) {
    const wire = words.has("wireframe") && !words.has("solid", "no wireframe");
    for (const layer of editable) if (layer.type === "shape" || layer.type === "tunnel") change(layer, { [layer.type]: { wireframe: wire } });
    notes.push(wire ? "switched to wireframe" : "made surfaces solid");
  }
  // Particle count / density.
  if (words.has("denser", "dense", "sparser", "sparse") || (mentioned.includes("particles") && (more || less) && !addIntent && scene.layers.some((l) => l.type === "particles"))) {
    const k = words.has("sparser", "sparse") || (less && !more) ? 0.6 : 1.6;
    for (const layer of scene.layers) if (layer.type === "particles" && !removedIds.has(layer.id)) change(layer, { particles: { count: Math.round(Math.min(40000, Math.max(100, layer.particles.count * k))) } });
    notes.push(k > 1 ? "increased the particle density" : "thinned out the particles");
  }
  // Reactivity: "react more to bass", "more reactive", "less reactive to highs".
  const reactive = words.has("react", "reacts", "reacting", "reactive", "reactivity", "responsive", "respond", "sensitive", "sensitivity", "pump", "pulse", "pulsing");
  if (reactive || (words.has(...BASS_WORDS, ...HIGH_WORDS, ...MID_WORDS) && (more || less) && !colorHex)) {
    const band: AudioBand | null = words.has(...BASS_WORDS) ? "bass" : words.has(...HIGH_WORDS) ? "highs" : words.has(...MID_WORDS) ? "mids" : words.has(...BEAT_WORDS) ? "onset" : null;
    const k = less && !more ? 0.6 : 1.5;
    const affected = editable.length > 0 ? editable : scene.layers;
    for (const layer of affected) {
      let reactivity = layer.reactivity.map((mp) => (band === null || mp.source === band ? { ...mp, amount: clampAmount(mp.amount * k) } : mp));
      if (band && k > 1 && !layer.reactivity.some((mp) => mp.source === band) && reactivity.length < LIMITS.maxMappingsPerLayer) {
        const target: MappingTarget = (["scale", "displacement", "brightness"] as const).find((tg) => layerSupportsTarget(layer.type, tg)) ?? "brightness";
        reactivity = [...reactivity, createMapping({ source: band, target, amount: 0.8 })];
      }
      change(layer, { reactivity });
    }
    if (band === null) ops.push({ op: "updateAudio", changes: { sensitivity: r2(Math.min(3, Math.max(0, scene.audio.sensitivity * (k > 1 ? 1.25 : 0.8)))) } });
    notes.push(`${k > 1 ? "strengthened" : "softened"} reactions${band ? ` to the ${band === "onset" ? "beat" : band}` : ""}`);
  }
  // Hide / show.
  if (words.has("hide", "invisible") || words.has("show", "unhide", "visible")) {
    const visible = !words.has("hide", "invisible");
    for (const layer of targets) if (!removedIds.has(layer.id)) change(layer, { visible });
    notes.push(visible ? "made layers visible" : "hid the layer");
  }
  // Rename.
  const rename = /(?:rename(?: (?:the )?scene| it)?|call it|name it)\s+(?:to\s+)?["“']?([^"”']{1,48})["”']?\s*$/i.exec(prompt.trim());
  if (rename) {
    const name = rename[1].replace(/[<>`{}\\]/g, "").trim().slice(0, LIMITS.maxNameLength);
    if (name) {
      ops.push({ op: "renameScene", name });
      notes.push(`renamed the scene to "${name}"`);
    }
  }

  for (const [layerId, changes] of layerChanges) ops.unshift({ op: "updateLayer", layerId, changes });
  if (ops.length === 0) {
    return {
      patch: { ops: [] },
      summary: "I couldn't match that to a change. Try “more red”, “faster”, “bigger rings”, “more glow”, “add particles”, “remove the grid” or “react more to bass”.",
      warnings,
    };
  }
  const summary = `${notes.length ? notes.join("; ").replace(/^./, (c) => c.toUpperCase()) : "Updated the scene"}.`;
  return { patch: { ops: ops.slice(0, 40) }, summary: summary.slice(0, 600), warnings };
}

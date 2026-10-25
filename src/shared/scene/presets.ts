/**
 * Visual presets.
 *
 * OWNERSHIP: Agent 1 (Frontend UI & 3D) may tune and add presets here.
 * The exported API (PresetDefinition, PRESETS, getPreset, createPresetScene,
 * DEFAULT_PRESET_ID) is a shared contract used by the AI module and must stay stable.
 * Every preset must produce a schema-valid SceneConfig (enforced by tests).
 */
import { createLayer, createMapping, createScene } from "./defaults";
import type { SceneConfig } from "./schema";

export interface PresetDefinition {
  id: string;
  name: string;
  description: string;
  /** Keywords used by the AI fallback generator to match prompts. */
  tags: readonly string[];
  /** Two swatch colours for preset cards. */
  swatch: readonly [string, string];
  create: () => SceneConfig;
}

const m = createMapping;

export const PRESETS: readonly PresetDefinition[] = [
  {
    id: "neon-tunnel",
    name: "Neon Tunnel",
    description: "Cyberpunk tunnel of pulsing rings with bass-driven particles.",
    tags: ["cyberpunk", "neon", "tunnel", "futuristic", "red", "pink", "synth", "fast", "techno"],
    swatch: ["#ff2e88", "#22d3ee"],
    create: () =>
      createScene({
        name: "Neon Tunnel",
        preset: "neon-tunnel",
        origin: "preset",
        environment: {
          background: { mode: "gradient", colorA: "#040208", colorB: "#1a0414" },
          fog: { enabled: true, color: "#08030a", density: 0.03 },
          camera: { fov: 70, distance: 6, height: 0, autoRotate: false, shake: 0.35 },
        },
        post: { bloom: { intensity: 1.6, threshold: 0.15, audioBoost: 1.2 }, chromaticAberration: 0.3 },
        layers: [
          createLayer("tunnel", {
            name: "Cyber Tunnel",
            tunnel: { colorA: "#ff2e88", colorB: "#7c3aed", radius: 7, sides: 8, twist: 0.2 },
            reactivity: [m({ source: "energy", target: "speed", amount: 1.5 }), m({ source: "bass", target: "brightness", amount: 1 })],
          }),
          createLayer("rings", {
            name: "Pulse Rings",
            rings: { count: 18, radius: 4.5, spacing: 4, sides: 6, thickness: 0.05, colorA: "#ff2e88", colorB: "#22d3ee" },
            reactivity: [m({ source: "bass", target: "scale", amount: 0.45, threshold: 0.15 }), m({ source: "onset", target: "brightness", amount: 1.5, smoothing: 0.4 })],
          }),
          createLayer("particles", {
            name: "Data Dust",
            particles: { distribution: "tunnel", count: 9000, spread: 6, size: 0.05, colorA: "#ff5fa2", colorB: "#22d3ee" },
            reactivity: [m({ source: "bass", target: "speed", amount: 2 }), m({ source: "highs", target: "brightness", amount: 0.8 })],
          }),
        ],
      }),
  },
  {
    id: "nebula-drift",
    name: "Nebula Drift",
    description: "Slow spiral galaxy of soft particles in a violet nebula.",
    tags: ["space", "galaxy", "nebula", "calm", "ambient", "dreamy", "slow", "stars", "cosmic"],
    swatch: ["#8b5cf6", "#38bdf8"],
    create: () =>
      createScene({
        name: "Nebula Drift",
        preset: "nebula-drift",
        origin: "preset",
        environment: {
          background: { mode: "nebula", colorA: "#04030a", colorB: "#2a1052", intensity: 1.1 },
          fog: { enabled: false },
          camera: { distance: 18, height: 6, autoRotateSpeed: 0.25, shake: 0.05 },
        },
        post: { bloom: { intensity: 1.4, threshold: 0.1, audioBoost: 0.6 }, chromaticAberration: 0.08 },
        audio: { smoothing: 0.75 },
        layers: [
          createLayer("particles", {
            name: "Galaxy",
            particles: { distribution: "spiral", count: 22000, spread: 14, size: 0.045, colorA: "#a78bfa", colorB: "#38bdf8", turbulence: 0.3 },
            motion: { spin: [0, 0.08, 0], speed: 0.6 },
            reactivity: [m({ source: "energy", target: "brightness", amount: 0.9 }), m({ source: "bass", target: "displacement", amount: 0.5 })],
          }),
          createLayer("particles", {
            name: "Star Field",
            particles: { distribution: "shell", count: 4000, spread: 38, size: 0.08, colorA: "#ffffff", colorB: "#c4b5fd", twinkle: 0.9, turbulence: 0 },
            motion: { spin: [0, 0.01, 0], speed: 0.3 },
            reactivity: [m({ source: "highs", target: "brightness", amount: 0.7 })],
          }),
        ],
      }),
  },
  {
    id: "crystal-core",
    name: "Crystal Core",
    description: "A distorting crystal surrounded by orbiting shards and a halo.",
    tags: ["crystal", "geometric", "minimal", "abstract", "glass", "core", "orbit", "electronic"],
    swatch: ["#7c3aed", "#22d3ee"],
    create: () =>
      createScene({
        name: "Crystal Core",
        preset: "crystal-core",
        origin: "preset",
        environment: { background: { mode: "gradient", colorA: "#030308", colorB: "#0b1026" }, camera: { distance: 12, height: 2 } },
        layers: [
          createLayer("shape", {
            name: "Crystal",
            shape: { geometry: "icosahedron", detail: 1, color: "#140f2b", emissive: "#7c3aed", distortion: 0.35 },
            transform: { scale: 2.2 },
            reactivity: [m({ source: "bass", target: "scale", amount: 0.35 }), m({ source: "mids", target: "displacement", amount: 0.8 })],
          }),
          createLayer("shape", {
            name: "Shards",
            shape: { geometry: "octahedron", instances: 10, orbitRadius: 6, color: "#0b2530", emissive: "#22d3ee", wireframe: true, distortion: 0 },
            transform: { scale: 0.45 },
            motion: { spin: [0.3, 0.5, 0], speed: 1 },
            reactivity: [m({ source: "highs", target: "brightness", amount: 1 }), m({ source: "onset", target: "bounce", amount: 0.6 })],
          }),
          createLayer("rings", {
            name: "Halo",
            rings: { arrangement: "concentric", count: 4, radius: 3.5, spacing: 0.6, thickness: 0.02, colorA: "#c084fc", colorB: "#22d3ee" },
            transform: { rotation: [72, 0, 0] },
            reactivity: [m({ source: "energy", target: "brightness", amount: 1.2 })],
          }),
        ],
      }),
  },
  {
    id: "synthwave-horizon",
    name: "Synthwave Horizon",
    description: "Retro grid rolling to a neon sun under falling stars.",
    tags: ["synthwave", "retro", "80s", "outrun", "grid", "sunset", "vaporwave", "horizon"],
    swatch: ["#ff3cac", "#ffb000"],
    create: () =>
      createScene({
        name: "Synthwave Horizon",
        preset: "synthwave-horizon",
        origin: "preset",
        environment: {
          background: { mode: "gradient", colorA: "#0d0221", colorB: "#3a0a4a" },
          fog: { enabled: true, color: "#1a0526", density: 0.022 },
          camera: { fov: 60, distance: 16, height: 2.5, autoRotate: false, shake: 0.2 },
        },
        layers: [
          createLayer("grid", {
            name: "Neon Grid",
            grid: { color: "#ff3cac", wave: 1.6, divisions: 80 },
            transform: { position: [0, -3, 0] },
            reactivity: [m({ source: "bass", target: "displacement", amount: 1.2 }), m({ source: "energy", target: "speed", amount: 1 })],
          }),
          createLayer("shape", {
            name: "Neon Sun",
            blending: "additive",
            shape: { geometry: "sphere", detail: 4, color: "#ff7a1a", emissive: "#ff3c6e", flatShading: false, distortion: 0, metalness: 0, roughness: 1 },
            transform: { position: [0, 4, -40], scale: 9 },
            motion: { spin: [0, 0, 0], speed: 1 },
            glow: 2.2,
            reactivity: [m({ source: "bass", target: "brightness", amount: 0.6 })],
          }),
          createLayer("particles", {
            name: "Falling Stars",
            particles: { distribution: "cube", count: 3000, spread: 30, size: 0.07, colorA: "#ffd1f5", colorB: "#8be9ff", twinkle: 0.8 },
            reactivity: [m({ source: "highs", target: "brightness", amount: 0.9 })],
          }),
        ],
      }),
  },
  {
    id: "spectrum-halo",
    name: "Spectrum Halo",
    description: "Circular live spectrum with concentric rings and a particle aura.",
    tags: ["spectrum", "equalizer", "bars", "circular", "hip-hop", "visualizer", "classic"],
    swatch: ["#22d3ee", "#a855f7"],
    create: () =>
      createScene({
        name: "Spectrum Halo",
        preset: "spectrum-halo",
        origin: "preset",
        environment: { background: { mode: "solid", colorA: "#030307", colorB: "#030307" }, camera: { distance: 15, height: 0, autoRotate: false, shake: 0.25 } },
        layers: [
          createLayer("spectrum", {
            name: "Halo Spectrum",
            spectrum: { bars: 96, radius: 4.5, maxHeight: 5, colorA: "#22d3ee", colorB: "#a855f7" },
            reactivity: [m({ source: "onset", target: "brightness", amount: 1, smoothing: 0.5 })],
          }),
          createLayer("rings", {
            name: "Inner Rings",
            rings: { arrangement: "concentric", count: 5, radius: 1.5, spacing: 0.5, thickness: 0.03, colorA: "#a855f7", colorB: "#22d3ee" },
            reactivity: [m({ source: "bass", target: "scale", amount: 0.5 })],
          }),
          createLayer("particles", {
            name: "Aura",
            particles: { distribution: "disc", count: 5000, spread: 10, size: 0.04, colorA: "#7dd3fc", colorB: "#c084fc" },
            reactivity: [m({ source: "bass", target: "displacement", amount: 1 }), m({ source: "energy", target: "rotation", amount: 0.6 })],
          }),
        ],
      }),
  },
  {
    id: "monolith",
    name: "Monolith",
    description: "Dark, restrained metallic torus knot with subtle dust.",
    tags: ["dark", "minimal", "metallic", "moody", "slow", "cinematic", "industrial"],
    swatch: ["#6b7280", "#e5e7eb"],
    create: () =>
      createScene({
        name: "Monolith",
        preset: "monolith",
        origin: "preset",
        environment: {
          background: { mode: "gradient", colorA: "#020203", colorB: "#0c0c10" },
          lighting: { ambient: 0.2, key: 2.4, keyColor: "#ffffff", rimColor: "#8b5cf6" },
          camera: { distance: 11, autoRotateSpeed: 0.15, shake: 0.05 },
        },
        post: { bloom: { intensity: 0.7, threshold: 0.4, audioBoost: 0.4 }, chromaticAberration: 0.05, vignette: 0.7, noise: 0.15 },
        layers: [
          createLayer("shape", {
            name: "Knot",
            blending: "normal",
            shape: { geometry: "torusKnot", detail: 3, color: "#1f2027", emissive: "#2e1065", metalness: 0.95, roughness: 0.18, flatShading: false, distortion: 0.1 },
            transform: { scale: 1.8 },
            glow: 0.4,
            reactivity: [m({ source: "bass", target: "scale", amount: 0.2 }), m({ source: "energy", target: "rotation", amount: 0.4 })],
          }),
          createLayer("particles", {
            name: "Dust",
            particles: { distribution: "sphere", count: 2500, spread: 16, size: 0.03, colorA: "#9ca3af", colorB: "#c4b5fd", twinkle: 0.6 },
            glow: 0.8,
            reactivity: [m({ source: "highs", target: "brightness", amount: 0.5 })],
          }),
        ],
      }),
  },
];

export const DEFAULT_PRESET_ID = "neon-tunnel";

export function getPreset(id: string): PresetDefinition | undefined {
  return PRESETS.find((p) => p.id === id);
}

/** Creates a fresh scene (new IDs) from a preset; falls back to the default preset. */
export function createPresetScene(id: string = DEFAULT_PRESET_ID): SceneConfig {
  return (getPreset(id) ?? PRESETS[0]).create();
}

# VANTA architecture

VANTA is a single-page Next.js 16 app (App Router, React 19, TypeScript, Tailwind v4).
The studio is client-only (`src/features/studio/StudioLoader.tsx` loads it with `ssr: false`).
The only server code is the AI scene API (`src/app/api/scene`).

## One state, one renderer, one audio engine

```
                ┌──────────────────────── useSceneStore (src/store/sceneStore.ts) ───────────────────────┐
 Inspector ───► │ scene: SceneConfig  · selectedLayerId · undo/redo · revision                            │ ◄─── AI (applyPatch / setScene)
 Presets   ───► │ all writes are validated + clamped (sanitizeLayer / sanitizeSceneConfig)                │ ◄─── Project load / share link
 Node graph ──► └──────────────────────────────────────────────┬──────────────────────────────────────────┘
                                                               │ React props (edit-time only)
 Audio source → AudioController (Agent 2) → publishAudioFrame ─┼─► audioBus.features / .spectrum (mutable, per frame)
                                                               ▼
                         Renderer useFrame: computeModulation(scene, audioBus.features, dt, liveModulation)
                                    → layer components read getLayerModulation(liveModulation, layer.id)
                                    → Three.js objects/uniforms updated in place (no React state per frame)
 RendererHandle (registerRenderer) ─► ExportController (Agent 2) → canvas.captureStream + audio track → MediaRecorder → .webm
```

## Canonical contracts (owned by the lead orchestrator — do not redefine or edit)

| Contract | File |
| --- | --- |
| SceneConfig, layers (discriminated union on `type`), bounds, mappings, node graph | `src/shared/scene/schema.ts` |
| Factories / defaults (`createLayer`, `createScene`, `createMapping`, `createGraphNode`) | `src/shared/scene/defaults.ts` |
| Layer registry: labels, supported mapping targets, **inspector field specs** (bounds read from the schema) | `src/shared/scene/layers.ts` |
| Untrusted-data repair: `sanitizeSceneConfig`, `sanitizeLayer` | `src/shared/scene/sanitize.ts` |
| Targeted edits: `ScenePatch`, `applyScenePatch` | `src/shared/scene/patch.ts` |
| File / share envelope: `createSceneFile`, `parseSceneFile` | `src/shared/scene/file.ts` |
| AudioFeatures, AudioController, AudioProfile | `src/shared/audio/contract.ts` |
| Per-frame audio bus: `audioBus`, `publishAudioFrame`, `resetAudioBus` | `src/shared/runtime/audioBus.ts` |
| Service registry: `registerAudioController/Renderer/ExportController`, getters | `src/shared/runtime/registry.ts` |
| RendererHandle, RenderQuality | `src/shared/render/contract.ts` |
| ExportController, RecordingOptions/Result | `src/shared/export/contract.ts` |
| AI API request/response/error schemas | `src/shared/ai/contract.ts` |
| Mapping engine: `computeModulation`, `liveModulation`, graph evaluation | `src/shared/modulation/engine.ts` |
| Scene store (the only scene state) | `src/store/sceneStore.ts` |

Exception: `src/shared/scene/presets.ts` is owned by Agent 1 (visual presets), but its exported API is fixed.

### Key rules
* Layer array order = draw order (index 0 drawn first).
* Mapping semantics (`MAPPING_TARGETS` in schema.ts): `m = Σ gate(feature) × amount × scene.audio.sensitivity`;
  renderers apply `scale × (1+m)`, `opacity × (1+m)`, `glow × (1+m)` for brightness, `speed × (1+m)`,
  `rotation + m rad`, `hue + m × 0.5 turns`, `displacement + m`, `size × (1+m)`, `y + m` for bounce.
* AudioFeatures values are always 0..1. Playback-only sources (SoundCloud, CORS-blocked URLs) must call
  `resetAudioBus()` and report `analysis: "unavailable"` — visuals must never fake reactivity.
* No component may generate or execute code from AI output. AI output always passes through
  `sanitizeSceneConfig` / `applyScenePatch`.
* Never call React `setState` per animation frame; use refs, `useFrame`, or rAF + direct DOM writes.

## File ownership

| Area | Owner | Paths |
| --- | --- | --- |
| Contracts, store, app shell, config | Lead orchestrator | `src/shared/**` (except presets.ts), `src/store/sceneStore.ts`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/features/studio/StudioLoader.tsx`, `package.json`, configs, `docs/`, `README.md` |
| Frontend UI & 3D graphics | Agent 1 | `src/features/studio/**` (not StudioLoader), `src/features/renderer/**`, `src/components/ui/**`, `src/store/editorStore.ts`, `src/app/globals.css`, `src/shared/scene/presets.ts` |
| Audio, interaction & export | Agent 2 | `src/features/audio/**`, `src/features/export/**`, `src/features/nodes/**` |
| Backend, AI & scene intelligence | Agent 3 | `src/app/api/**`, `src/server/**`, `src/features/ai/**`, `src/features/persistence/**`, `.env.example` |

### Integration slots (signatures fixed; owner replaces the stub)
| Slot | Owner | Mounted by |
| --- | --- | --- |
| `AudioEngineProvider` (`src/features/audio/AudioEngineProvider.tsx`) — creates + registers the single AudioController and ExportController | Agent 2 | Studio root (Agent 1) |
| `AudioPlayerBar` (`src/features/audio/components/AudioPlayerBar.tsx`) | Agent 2 | Studio bottom bar |
| `AudioDropOverlay` (`src/features/audio/components/AudioDropOverlay.tsx`) | Agent 2 | Studio root |
| `ExportMenu` (`src/features/export/components/ExportMenu.tsx`) | Agent 2 | Toolbar |
| `NodeGraphPanel` (`src/features/nodes/components/NodeGraphPanel.tsx`) | Agent 2 | Bottom drawer (`editorStore.bottomPanel === "nodes"`) |
| `useSceneAI` (`src/features/ai/useSceneAI.ts`) | Agent 3 | Prompt bar (Agent 1) |
| `ProjectMenu` (`src/features/persistence/components/ProjectMenu.tsx`) | Agent 3 | Toolbar |
| `PersistenceBoot` (`src/features/persistence/PersistenceBoot.tsx`) | Agent 3 | Studio root |
| `RendererHandle` via `registerRenderer` | Agent 1 | consumed by ExportController |

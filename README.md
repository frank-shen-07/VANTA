# VANTA

**VANTA** is a browser-based, real-time 3D visual studio, inspired by TouchDesigner. Load a track, describe a world in plain language, and watch particles, rings, tunnels and geometry react to the music. Then edit every layer, wire up audio behaviour in a node graph, and export the result as video.

**Workflow:** choose music → generate a scene → watch it react → edit the visuals → export.

## Status

**Working (verified in headless Chrome against a production build):**
- MP3/WAV upload, plus drag-and-drop. Non-audio files are rejected. Play, pause, seek, volume, mute and track replacement work.
- Real Web Audio analysis: bass, mids, highs, energy, onsets and a 64-bin spectrum. It drives a per-layer mapping engine.
- WebGL renderer with a GPU **particle** layer (6 distributions) that responds to the audio mappings.
- WebM recording of the live canvas with an audio track, and PNG still export.
- AI scene generation and targeted refinement through `/api/scene`, using the built-in offline heuristic generator. Validation, rate limiting and readable errors are in place.
- Data-driven inspector covering every layer and scene property and the audio-mapping editor. Also: layers panel, presets, undo/redo, and autosave/restore.

**Not finished yet:**
- Rendering for the rings, shape, tunnel, grid and spectrum layers. Their data, inspector controls and AI support exist, but they draw nothing yet.
- Background modes, fog, lights and post-processing.
- The LLM call (Claude). `ANTHROPIC_API_KEY` is detected, but generation still uses the heuristic generator.
- The node graph UI, the project library / ProjectMenu, share links, and file import/export.
- Untested in a browser: microphone, URL and SoundCloud sources.

## Getting started

Requirements: Node.js 20+ (developed on Node 24) and a recent Chromium-based browser, Firefox or Safari with WebGL2.

```bash
npm install
cp .env.example .env.local   # optional: add ANTHROPIC_API_KEY for LLM scene generation
npm run dev                  # http://localhost:3000
```

### Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | No | Reserved for Claude-powered generation. It is detected, but the LLM call is not wired up yet. |
| `VANTA_AI_MODEL` | No | Overrides the Claude model (default `claude-opus-5-5`). |
| `VANTA_AI_EFFORT` | No | Overrides the model effort level (`low`, `medium`, …). |

Keys are read only on the server, in `src/app/api/scene`. They never reach the browser.

### Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and server |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | Vitest unit and contract tests |
| `npm run e2e` | Headless-Chrome end-to-end smoke test against a running server (`VANTA_URL`, default `http://localhost:3000`) |

## Architecture

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). In short:

- `src/shared/**` holds the canonical contracts: the `SceneConfig` Zod schema and bounds, the layer registry with inspector field specs, the sanitizer, scene patches, and the audio, renderer, export and AI interfaces.
- `src/store/sceneStore.ts` is the single scene state. The inspector, AI, presets, persistence and node graph all write through it, and the renderer reads from it.
- Audio features travel every frame through a mutable `audioBus`. Once per rendered frame, `computeModulation` turns them into per-layer modulation. Nothing in that path updates React state per frame.
- Export records the exact WebGL canvas the renderer registers, using `canvas.captureStream` and MediaRecorder.

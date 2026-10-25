# VANTA

**VANTA** is a browser-based, real-time 3D visual studio, inspired by TouchDesigner. Load a track, describe a world in plain language, and watch particles, rings, tunnels and geometry react to the music. Then edit every layer, wire up audio behaviour in a node graph, and export the result as video.

**Workflow:** choose music → generate a scene → watch it react → edit the visuals → export.

## Status

**Verified in headless Chrome** against a production build (`npm run e2e`, 25/25 checks):
- MP3/WAV upload; non-audio files are rejected.
- Playback with pause, seek, volume, mute and track replacement.
- Real Web Audio analysis (bass, mids, highs, energy, onsets, spectrum) driving the visuals.
- Six GPU layer types (particles, rings, shape, tunnel, grid, spectrum) with backgrounds, fog, lights and post-processing.
- Layer edits and visibility changes show up in the rendered frame.
- AI generate and refine through `/api/scene`; refinement keeps manual edits.
- All presets.
- Fullscreen presentation that keeps the same canvas with audio still playing.
- Two WebM recordings in a row, with audio and changing frames, plus PNG stills.
- Autosave and restore after a reload.

**Built and unit-tested, not exercised end to end:**
- The Claude call. It was only tested with a mocked client; no API key was available. Without a key, the offline heuristic generator is used.
- The project library, `.vanta.json` import/export and share links.
- The node graph editor. Only adding nodes was checked in a browser.
- Microphone, direct-URL (CORS fallback) and SoundCloud sources.

**Known limitations:**
- The API rate limit is in memory and keyed on `x-forwarded-for`, which a client can spoof.
- Recorded WebM files have no duration header.
- Thin rings seen edge-on show aliasing.
- The selected layer isn't highlighted in the viewport.

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
| `ANTHROPIC_API_KEY` | No | Turns on Claude scene generation and refinement (falls back to the offline generator on any error). |
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

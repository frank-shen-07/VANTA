# VANTA

**VANTA** is a browser-based, real-time 3D visual studio, inspired by TouchDesigner. Load a track, describe a world in plain language, and watch particles, rings, tunnels and geometry react to the music. Then edit every layer, wire up audio behaviour in a node graph, and export the result as video.

**Workflow:** choose music → generate a scene → watch it react → edit the visuals → export.

## Features

- **Music:** upload or drag-and-drop MP3 and WAV files. Play, pause, restart, seek, adjust volume and mute. VANTA also supports microphone input and direct audio URLs that allow CORS. SoundCloud embeds play back only.
- **Real audio analysis:** the Web Audio API extracts bass, mids, highs, energy, onsets and a 64-bin spectrum from whatever is playing. The source you hear is the source that drives the visuals. Sources that can only be played back are labelled, and VANTA never fakes reactivity for them.
- **3D renderer:** built on Three.js and React Three Fiber, with six GPU layer types: particles, rings, shapes, tunnel, grid and spectrum. Atmosphere comes from gradient and nebula backgrounds, fog and lighting. Post-processing adds bloom, chromatic aberration, vignette and grain. Quality has three levels.
- **Audio reactivity:** each layer can have mappings, such as bass → scale or highs → brightness, with amount, threshold and smoothing. A global sensitivity setting scales all of them. Audio can also shake the camera and pump the bloom.
- **Node graph:** React Flow nodes (Audio Band → Multiply / Clamp / Smooth / Remap → Visual Parameter) that drive real visual parameters.
- **AI scene generation:** describe a scene and VANTA builds it, or refine the current scene with targeted edits that keep your manual changes. The server uses Claude when `ANTHROPIC_API_KEY` is set. Without a key, a built-in offline generator takes over. Every AI result is validated against the shared Zod schema, and no generated code is ever executed.
- **Editing:** a layers panel to add, remove, duplicate, reorder, show/hide and rename layers. A properties inspector exposes every layer property plus scene, environment and post-processing settings. Undo and redo are supported.
- **Presets**, a **fullscreen presentation mode**, and **keyboard shortcuts**.
- **Export:** record WebM video (MP4 where the browser supports it), including the audio when the source allows. You can also save a PNG still.
- **Projects:** a browser project library with autosave, `.vanta.json` import and export, and share links.

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
| `ANTHROPIC_API_KEY` | No | Turns on Claude-powered scene generation and refinement. Without it, the offline heuristic generator is used. |
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

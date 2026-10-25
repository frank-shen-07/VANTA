/**
 * RENDERER CONTRACT — owned by the lead orchestrator, implemented by Agent 1.
 *
 * - Scene input: the renderer subscribes to `useSceneStore` (src/store/sceneStore.ts).
 *   Layer components receive their Layer config as props and update Three.js
 *   objects/uniforms in place; React re-renders only when the config changes.
 * - Audio input: inside `useFrame`, read `audioBus` (src/shared/runtime/audioBus.ts)
 *   and call `computeModulation` (src/shared/modulation/engine.ts) once per frame.
 *   Never call React setState per frame.
 * - Selection: `useSceneStore(s => s.selectedLayerId)`; clicking an object in the
 *   viewport calls `selectLayer(id)`.
 * - Canvas: the live WebGL canvas is exposed through a RendererHandle registered
 *   with `registerRenderer` (src/shared/runtime/registry.ts). Export records that
 *   exact canvas. The <Canvas> must never be remounted by layout changes
 *   (fullscreen, panel toggles), so playback and scene state survive.
 */

export type RenderQuality = "low" | "balanced" | "high";

export const RENDER_QUALITY_SETTINGS: Record<RenderQuality, { maxDpr: number; particleScale: number; postprocessing: boolean; label: string }> = {
  low: { maxDpr: 1, particleScale: 0.4, postprocessing: false, label: "Low" },
  balanced: { maxDpr: 1.5, particleScale: 0.75, postprocessing: true, label: "Balanced" },
  high: { maxDpr: 2, particleScale: 1, postprocessing: true, label: "High" },
};

export type RendererStatus = "initializing" | "ready" | "context-lost" | "unsupported" | "error";

export interface RendererStats {
  fps: number;
  frameMs: number;
  drawCalls: number;
  triangles: number;
  points: number;
  width: number;
  height: number;
  dpr: number;
}

export interface StillCaptureOptions {
  mimeType?: "image/png" | "image/jpeg" | "image/webp";
  /** 0..1 for lossy formats. */
  quality?: number;
}

export interface RendererHandle {
  /** The actual WebGL canvas being displayed. */
  getCanvas(): HTMLCanvasElement;
  /** Captures the next fully rendered frame (including post-processing). */
  captureStill(options?: StillCaptureOptions): Promise<Blob>;
  getStats(): RendererStats;
  getStatus(): RendererStatus;
}

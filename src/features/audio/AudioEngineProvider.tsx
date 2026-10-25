"use client";

/**
 * Mounted once at the studio root. Creates the single AudioController and
 * ExportController, registers them in @/shared/runtime/registry, and disposes
 * them on unmount (StrictMode-safe: each mount creates and each cleanup fully
 * releases its own instances). Renders its children unchanged.
 */
import { useEffect, type ReactNode } from "react";
import { VideoExporter } from "@/features/export/VideoExporter";
import { computeModulation, liveModulation } from "@/shared/modulation/engine";
import { audioBus } from "@/shared/runtime/audioBus";
import {
  getAudioController,
  getExportController,
  getRenderer,
  registerAudioController,
  registerExportController,
  registerRenderer,
} from "@/shared/runtime/registry";
import { useSceneStore } from "@/store/sceneStore";
import { AudioEngine } from "./engine/AudioEngine";

declare global {
  interface Window {
    __VANTA_DEBUG__?: Record<string, unknown>;
  }
}

export function AudioEngineProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const engine = new AudioEngine();
    const exporter = new VideoExporter();
    const unregisterAudio = registerAudioController(engine);
    const unregisterExport = registerExportController(exporter);
    if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
      // Development-only hooks for automated verification.
      window.__VANTA_DEBUG__ = {
        ...(window.__VANTA_DEBUG__ ?? {}),
        audioBus,
        getAudioController,
        getExportController,
        getRenderer,
        registerRenderer,
        useSceneStore,
        liveModulation,
        computeModulation,
      };
    }
    return () => {
      unregisterExport();
      unregisterAudio();
      exporter.dispose();
      engine.dispose();
    };
  }, []);

  return <>{children}</>;
}

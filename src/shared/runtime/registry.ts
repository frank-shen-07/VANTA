/**
 * Runtime service registry — owned by the lead orchestrator.
 *
 * Exactly one AudioController, one RendererHandle and one ExportController
 * exist at a time. Implementations register themselves here; consumers look
 * them up (or subscribe) instead of importing implementation modules, which
 * keeps the three feature areas decoupled and prevents duplicate engines.
 */
import type { AudioController } from "@/shared/audio/contract";
import type { ExportController } from "@/shared/export/contract";
import type { RendererHandle } from "@/shared/render/contract";

type Services = {
  audio: AudioController | null;
  renderer: RendererHandle | null;
  exporter: ExportController | null;
};

const services: Services = { audio: null, renderer: null, exporter: null };
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function register<K extends keyof Services>(key: K, value: NonNullable<Services[K]>): () => void {
  if (services[key] && services[key] !== value && process.env.NODE_ENV !== "production") {
    console.warn(`[VANTA] replacing registered ${key} service — there should only be one.`);
  }
  services[key] = value;
  notify();
  return () => {
    if (services[key] === value) {
      services[key] = null;
      notify();
    }
  };
}

export const registerAudioController = (c: AudioController) => register("audio", c);
export const registerRenderer = (r: RendererHandle) => register("renderer", r);
export const registerExportController = (e: ExportController) => register("exporter", e);

export const getAudioController = () => services.audio;
export const getRenderer = () => services.renderer;
export const getExportController = () => services.exporter;

/** Notified whenever a service registers or unregisters (use with useSyncExternalStore). */
export function subscribeServices(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

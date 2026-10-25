"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { ExportController, ExportState } from "@/shared/export/contract";
import type { RendererHandle } from "@/shared/render/contract";
import { getExportController, getRenderer, subscribeServices } from "@/shared/runtime/registry";
import { INITIAL_EXPORT_STATE } from "./VideoExporter";

const noop = () => {};
const getNull = () => null;

export function useExportController(): ExportController | null {
  return useSyncExternalStore(subscribeServices, getExportController, getNull);
}

export function useRendererHandle(): RendererHandle | null {
  return useSyncExternalStore(subscribeServices, getRenderer, getNull);
}

export function useExportState(): ExportState {
  const controller = useExportController();
  const subscribe = useCallback((onChange: () => void) => (controller ? controller.subscribe(onChange) : noop), [controller]);
  const getSnapshot = useCallback(() => (controller ? controller.getState() : INITIAL_EXPORT_STATE), [controller]);
  return useSyncExternalStore(subscribe, getSnapshot, () => INITIAL_EXPORT_STATE);
}

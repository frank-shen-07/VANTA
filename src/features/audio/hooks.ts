"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { AudioController, AudioControllerState } from "@/shared/audio/contract";
import { getAudioController, subscribeServices } from "@/shared/runtime/registry";
import { INITIAL_AUDIO_STATE } from "./engine/AudioEngine";

const noopUnsubscribe = () => {};
const getNullController = () => null;

/** The registered AudioController (null until AudioEngineProvider has mounted). */
export function useAudioController(): AudioController | null {
  return useSyncExternalStore(subscribeServices, getAudioController, getNullController);
}

/** Transport/source snapshot; re-renders at most ~10×/s while playing. */
export function useAudioState(): AudioControllerState {
  const controller = useAudioController();
  const subscribe = useCallback((onChange: () => void) => (controller ? controller.subscribeState(onChange) : noopUnsubscribe), [controller]);
  const getSnapshot = useCallback(() => (controller ? controller.getState() : INITIAL_AUDIO_STATE), [controller]);
  return useSyncExternalStore(subscribe, getSnapshot, () => INITIAL_AUDIO_STATE);
}

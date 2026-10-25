/**
 * Minimal typed wrapper around the official SoundCloud Widget API
 * (https://w.soundcloud.com/player/api.js). Playback control only — embedded
 * SoundCloud audio is cross-origin and never reaches Web Audio, so it is
 * always reported as playback-only. Streams are never extracted.
 */

export interface SoundCloudSound {
  title?: string;
  permalink_url?: string;
  user?: { username?: string };
  duration?: number;
}

export interface SoundCloudWidget {
  bind(event: string, listener: (data?: { currentPosition?: number; relativePosition?: number }) => void): void;
  unbind(event: string): void;
  play(): void;
  pause(): void;
  seekTo(ms: number): void;
  setVolume(volume: number): void;
  getDuration(callback: (ms: number) => void): void;
  getCurrentSound(callback: (sound: SoundCloudSound | null) => void): void;
}

interface SoundCloudApi {
  Widget: ((iframe: HTMLIFrameElement) => SoundCloudWidget) & {
    Events: { READY: string; PLAY: string; PAUSE: string; FINISH: string; PLAY_PROGRESS: string; SEEK: string; ERROR: string };
  };
}

declare global {
  interface Window {
    SC?: SoundCloudApi;
  }
}

const API_SRC = "https://w.soundcloud.com/player/api.js";
let apiPromise: Promise<SoundCloudApi> | null = null;

export function loadSoundCloudApi(timeoutMs = 12000): Promise<SoundCloudApi> {
  if (typeof window === "undefined") return Promise.reject(new Error("SoundCloud requires a browser."));
  if (window.SC?.Widget) return Promise.resolve(window.SC);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise<SoundCloudApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = API_SRC;
    script.async = true;
    const timer = window.setTimeout(() => fail("Timed out loading the SoundCloud widget API (offline or blocked?)."), timeoutMs);
    function fail(message: string) {
      window.clearTimeout(timer);
      script.remove();
      apiPromise = null;
      reject(new Error(message));
    }
    script.onload = () => {
      window.clearTimeout(timer);
      if (window.SC?.Widget) resolve(window.SC);
      else fail("The SoundCloud widget API did not initialise.");
    };
    script.onerror = () => fail("Couldn't load the SoundCloud widget API (offline or blocked by the browser?).");
    document.head.appendChild(script);
  });
  return apiPromise;
}

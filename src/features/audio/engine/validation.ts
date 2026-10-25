/** Pure validation helpers for audio inputs (files, URLs). */
import { ACCEPTED_AUDIO_EXTENSIONS, ACCEPTED_AUDIO_MIME_TYPES, MAX_AUDIO_FILE_BYTES } from "@/shared/audio/contract";

export type AudioFormat = "mp3" | "wav";

export type FileValidation =
  | { ok: true; format: AudioFormat; mimeType: string }
  | { ok: false; error: string };

export interface FileLike {
  name: string;
  type: string;
  size: number;
}

const MIME_FORMAT: Record<string, AudioFormat> = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/vnd.wave": "wav",
};

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Validates name/extension, MIME type and size. Decodability is checked by the media element. */
export function validateAudioFile(file: FileLike): FileValidation {
  const ext = fileExtension(file.name);
  const mime = (file.type || "").toLowerCase().split(";")[0].trim();
  const extOk = (ACCEPTED_AUDIO_EXTENSIONS as readonly string[]).includes(ext);
  const mimeOk = (ACCEPTED_AUDIO_MIME_TYPES as readonly string[]).includes(mime);
  const label = file.name || "This file";
  if (!extOk && !mimeOk) {
    return { ok: false, error: `“${label}” isn't an MP3 or WAV file. VANTA accepts .mp3 and .wav audio.` };
  }
  if (extOk && mime && !mimeOk && mime !== "application/octet-stream" && !mime.startsWith("audio/")) {
    return { ok: false, error: `“${label}” has a .${ext.slice(1)} name but its type is ${mime}, not audio.` };
  }
  if (!Number.isFinite(file.size) || file.size <= 0) {
    return { ok: false, error: `“${label}” is empty.` };
  }
  if (file.size > MAX_AUDIO_FILE_BYTES) {
    return { ok: false, error: `“${label}” is ${formatBytes(file.size)} — the limit is ${formatBytes(MAX_AUDIO_FILE_BYTES)}.` };
  }
  const format: AudioFormat = extOk ? (ext === ".mp3" ? "mp3" : "wav") : MIME_FORMAT[mime];
  const mimeType = mimeOk ? mime : format === "mp3" ? "audio/mpeg" : "audio/wav";
  return { ok: true, format, mimeType };
}

/** Parses a user-entered http(s) URL. */
export function parseHttpUrl(input: string): URL | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/** Short label for a URL source: last path segment or host. */
export function urlLabel(url: URL): string {
  const segment = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() ?? "");
  return segment ? segment.slice(0, 80) : url.host;
}

const SOUNDCLOUD_HOSTS = new Set(["soundcloud.com", "www.soundcloud.com", "m.soundcloud.com", "on.soundcloud.com", "api.soundcloud.com", "snd.sc"]);

export function isSoundCloudUrl(input: string): boolean {
  const url = parseHttpUrl(input);
  return !!url && SOUNDCLOUD_HOSTS.has(url.hostname.toLowerCase()) && url.pathname.length > 1;
}

/** Official embed widget URL (no stream extraction). */
export function soundCloudEmbedUrl(trackUrl: string): string {
  const params = new URLSearchParams({
    url: trackUrl,
    auto_play: "false",
    visual: "false",
    hide_related: "true",
    show_comments: "false",
    show_user: "true",
    show_reposts: "false",
    show_teaser: "false",
    color: "#8b5cf6",
  });
  return `https://w.soundcloud.com/player/?${params.toString()}`;
}

/** Media error code → user-facing message. */
export function mediaErrorMessage(code: number | undefined, context: "file" | "url"): string {
  switch (code) {
    case 1:
      return "Loading was aborted.";
    case 2:
      return context === "url" ? "Network error while loading the audio URL." : "The file could not be read.";
    case 3:
      return "The audio could not be decoded — the file may be corrupted.";
    case 4:
      return context === "url"
        ? "That URL didn't return playable MP3/WAV audio (unsupported format or not found)."
        : "This file couldn't be decoded as MP3/WAV audio — it may be corrupted or mislabelled.";
    default:
      return context === "url" ? "The audio URL could not be loaded." : "The audio file could not be loaded.";
  }
}

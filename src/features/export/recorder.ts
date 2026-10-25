/** Pure helpers for video export (format selection, file naming). */
import type { RecordingFormat } from "@/shared/export/contract";

/** Candidates in order of preference. */
export const FORMAT_CANDIDATES: readonly RecordingFormat[] = [
  { id: "webm-vp9-opus", label: "WebM · VP9", mimeType: "video/webm;codecs=vp9,opus", container: "webm", extension: "webm", supportsAudio: true },
  { id: "webm-vp8-opus", label: "WebM · VP8", mimeType: "video/webm;codecs=vp8,opus", container: "webm", extension: "webm", supportsAudio: true },
  { id: "webm", label: "WebM", mimeType: "video/webm", container: "webm", extension: "webm", supportsAudio: true },
  { id: "mp4-avc-aac", label: "MP4 · H.264", mimeType: "video/mp4;codecs=avc1.42E01E,mp4a.40.2", container: "mp4", extension: "mp4", supportsAudio: true },
  { id: "mp4-avc-opus", label: "MP4 · H.264 / Opus", mimeType: "video/mp4;codecs=avc1,opus", container: "mp4", extension: "mp4", supportsAudio: true },
  { id: "mp4", label: "MP4", mimeType: "video/mp4", container: "mp4", extension: "mp4", supportsAudio: true },
];

export type IsTypeSupported = (mimeType: string) => boolean;

/** Supported formats in preference order (WebM VP9 first). */
export function supportedFormats(isTypeSupported: IsTypeSupported | null | undefined): RecordingFormat[] {
  if (!isTypeSupported) return [];
  return FORMAT_CANDIDATES.filter((f) => {
    try {
      return isTypeSupported(f.mimeType);
    } catch {
      return false;
    }
  });
}

/** The requested format when supported, else the best supported one, else null. */
export function pickFormat(isTypeSupported: IsTypeSupported | null | undefined, formatId?: string): RecordingFormat | null {
  const formats = supportedFormats(isTypeSupported);
  if (formats.length === 0) return null;
  return (formatId && formats.find((f) => f.id === formatId)) || formats[0];
}

/** "My Scene: Neon / #1" → "my-scene-neon-1" (ascii, max 40 chars, never empty). */
export function sanitizeFileStem(name: string): string {
  const stem = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return stem || "scene";
}

/** Local timestamp "20261026-013012". */
export function fileTimestamp(date: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

/** vanta-<scene-name>-<timestamp>.<ext> */
export function exportFileName(sceneName: string, date: Date, extension: string): string {
  return `vanta-${sanitizeFileStem(sceneName)}-${fileTimestamp(date)}.${extension}`;
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export const QUALITY_PRESETS = [
  { id: "draft", label: "Draft · 4 Mbps", bitsPerSecond: 4_000_000 },
  { id: "standard", label: "Standard · 8 Mbps", bitsPerSecond: 8_000_000 },
  { id: "high", label: "High · 16 Mbps", bitsPerSecond: 16_000_000 },
  { id: "max", label: "Max · 32 Mbps", bitsPerSecond: 32_000_000 },
] as const;

export const DURATION_PRESETS = [15, 30, 60, 120, 300, 600] as const;

export function clampBitrate(bps: number): number {
  return Math.min(40_000_000, Math.max(1_000_000, Math.round(Number.isFinite(bps) ? bps : 8_000_000)));
}

export function clampMaxDuration(sec: number): number {
  return Math.min(600, Math.max(1, Number.isFinite(sec) ? sec : 120));
}

/**
 * Share links: `#scene=` + token. Token = "z" + base64url(deflate-raw(JSON))
 * when CompressionStream is available, else "j" + base64url(JSON). Loading
 * always goes through parseSceneFile (sanitized). Sizes are capped both ways.
 */
import { createSceneFile, parseSceneFile } from "@/shared/scene/file";
import type { SceneConfig } from "@/shared/scene/schema";

export const SHARE_HASH_PREFIX = "#scene=";
export const MAX_SHARE_TOKEN_LENGTH = 60_000;
const MAX_DECODED_BYTES = 1024 * 1024;

export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function pipe(bytes: Uint8Array, transform: CompressionStream | DecompressionStream, limit: number): Promise<Uint8Array> {
  const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(transform).getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      throw new Error("too large");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

export async function encodeSceneToken(scene: SceneConfig): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(createSceneFile(scene)));
  if (typeof CompressionStream !== "undefined") {
    try {
      return `z${toBase64Url(await pipe(json, new CompressionStream("deflate-raw"), MAX_DECODED_BYTES))}`;
    } catch {
      /* fall through to the uncompressed form */
    }
  }
  return `j${toBase64Url(json)}`;
}

export async function decodeSceneToken(token: string): Promise<{ ok: true; scene: SceneConfig; warnings: string[] } | { ok: false; error: string }> {
  if (!token || token.length > MAX_SHARE_TOKEN_LENGTH || !/^[zj][A-Za-z0-9_-]+$/.test(token)) return { ok: false, error: "This share link is invalid or too long." };
  try {
    const raw = fromBase64Url(token.slice(1));
    let bytes = raw;
    if (token[0] === "z") {
      if (typeof DecompressionStream === "undefined") return { ok: false, error: "This browser cannot open compressed share links." };
      bytes = await pipe(raw, new DecompressionStream("deflate-raw"), MAX_DECODED_BYTES);
    }
    return parseSceneFile(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return { ok: false, error: "This share link is damaged and could not be opened." };
  }
}

export function shareTokenFromHash(hash: string): string | null {
  return hash.startsWith(SHARE_HASH_PREFIX) ? hash.slice(SHARE_HASH_PREFIX.length) : null;
}

export async function buildShareUrl(scene: SceneConfig, baseUrl: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const token = await encodeSceneToken(scene);
  if (token.length > MAX_SHARE_TOKEN_LENGTH) return { ok: false, error: "This scene is too large for a share link — export a file instead." };
  return { ok: true, url: `${baseUrl.split("#")[0]}${SHARE_HASH_PREFIX}${token}` };
}

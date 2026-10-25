import { describe, expect, it } from "vitest";
import { createPresetScene } from "@/shared/scene/presets";
import { readAutosave, writeAutosave } from "./autosave";
import { deleteProject, listProjects, loadProject, saveProject } from "./library";
import { buildShareUrl, decodeSceneToken, encodeSceneToken, shareTokenFromHash } from "./shareLink";

class MemoryStorage {
  data = new Map<string, string>();
  failWrites = false;
  get length() {
    return this.data.size;
  }
  clear() {
    this.data.clear();
  }
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  key(i: number) {
    return [...this.data.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
  setItem(k: string, v: string) {
    if (this.failWrites) throw new DOMException("full", "QuotaExceededError");
    this.data.set(k, v);
  }
}

describe("share links", () => {
  it("round-trips a scene through deflate-raw + base64url", async () => {
    const scene = createPresetScene("crystal-core");
    const token = await encodeSceneToken(scene);
    expect(token[0]).toBe("z");
    const decoded = await decodeSceneToken(token);
    expect(decoded.ok && decoded.scene).toEqual(scene);
    const url = await buildShareUrl(scene, "https://vanta.app/studio#old");
    const fromUrl = url.ok ? shareTokenFromHash(new URL(url.url).hash) : null;
    const viaUrl = await decodeSceneToken(fromUrl ?? "");
    expect(viaUrl.ok && viaUrl.scene).toEqual(scene);
  });

  it("rejects damaged or hostile tokens", async () => {
    expect((await decodeSceneToken("z!!!")).ok).toBe(false);
    expect((await decodeSceneToken("zAAAA")).ok).toBe(false);
    expect((await decodeSceneToken(`j${btoa('{"hello":1}')}`)).ok).toBe(false);
  });
});

describe("project library + autosave", () => {
  it("saves, lists, opens and deletes projects", () => {
    const store = new MemoryStorage() as unknown as Storage;
    const scene = createPresetScene("monolith");
    const saved = saveProject(scene, "My Mono", null, store);
    expect(saved.ok).toBe(true);
    const list = listProjects(store);
    expect(list.ok && list.value.map((p) => [p.name, p.layerCount])).toEqual([["My Mono", scene.layers.length]]);
    const id = saved.ok ? saved.value.id : "";
    const opened = loadProject(id, store);
    expect(opened.ok && opened.value.scene.layers).toEqual(scene.layers);
    expect(deleteProject(id, store).ok).toBe(true);
    expect(listProjects(store).ok && (listProjects(store) as { value: unknown[] }).value).toEqual([]);
  });

  it("reports quota / corrupt / unavailable storage without throwing", () => {
    const mem = new MemoryStorage();
    const store = mem as unknown as Storage;
    mem.failWrites = true;
    const failed = saveProject(createPresetScene(), "x", null, store);
    expect(failed.ok).toBe(false);
    expect(writeAutosave(createPresetScene(), store).ok).toBe(false);
    mem.failWrites = false;
    mem.data.set("vanta:projects:v1", "{corrupt");
    expect(listProjects(store).ok).toBe(false);
    mem.data.set("vanta:autosave:v1", "{corrupt");
    expect(readAutosave(store).ok).toBe(false);
    expect(listProjects(null).ok).toBe(false);
  });

  it("autosave round-trips", () => {
    const store = new MemoryStorage() as unknown as Storage;
    const scene = createPresetScene("spectrum-halo");
    expect(writeAutosave(scene, store).ok).toBe(true);
    const back = readAutosave(store);
    expect(back.ok && back.scene).toEqual(scene);
  });
});

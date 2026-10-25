/**
 * Browser project library (`vanta:projects:v1`). Every storage access is
 * wrapped in try/catch (quota exceeded, private mode, disabled storage) and
 * returns a user-facing error instead of throwing. Scenes are always read back
 * through parseSceneFile (sanitized).
 */
import { createSceneFile, parseSceneFile } from "@/shared/scene/file";
import { LIMITS, type SceneConfig } from "@/shared/scene/schema";
import { createId, isPlainObject } from "@/shared/utils/object";

export const PROJECTS_KEY = "vanta:projects:v1";
export const MAX_PROJECTS = 50;

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: string;
  layerCount: number;
}

interface ProjectRecord extends ProjectSummary {
  file: unknown;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export function browserStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

const UNAVAILABLE = "Browser storage is unavailable (private mode or blocked).";

function isQuotaError(e: unknown): boolean {
  return typeof DOMException !== "undefined" && e instanceof DOMException && (e.name === "QuotaExceededError" || e.code === 22);
}

function readRecords(store: Storage): ProjectRecord[] {
  const raw = store.getItem(PROJECTS_KEY);
  if (!raw) return [];
  const data: unknown = JSON.parse(raw);
  const list = isPlainObject(data) && Array.isArray(data.projects) ? data.projects : [];
  return list.filter(
    (p): p is ProjectRecord => isPlainObject(p) && typeof p.id === "string" && typeof p.name === "string" && typeof p.updatedAt === "string" && "file" in p,
  );
}

function writeRecords(store: Storage, records: ProjectRecord[]): void {
  store.setItem(PROJECTS_KEY, JSON.stringify({ version: 1, projects: records }));
}

const summary = ({ id, name, updatedAt, layerCount }: ProjectRecord): ProjectSummary => ({ id, name, updatedAt, layerCount: Number(layerCount) || 0 });

export function listProjects(store: Storage | null = browserStorage()): Result<ProjectSummary[]> {
  if (!store) return { ok: false, error: UNAVAILABLE };
  try {
    return { ok: true, value: readRecords(store).map(summary).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) };
  } catch {
    return { ok: false, error: "Saved projects could not be read." };
  }
}

/** Saves (or overwrites, when `id` is given and exists) a project. */
export function saveProject(scene: SceneConfig, name: string, id?: string | null, store: Storage | null = browserStorage()): Result<ProjectSummary> {
  if (!store) return { ok: false, error: UNAVAILABLE };
  const cleanName = name.trim().slice(0, LIMITS.maxNameLength) || scene.name;
  try {
    let records: ProjectRecord[] = [];
    try {
      records = readRecords(store);
    } catch {
      records = [];
    }
    const record: ProjectRecord = {
      id: id && records.some((r) => r.id === id) ? id : createId("prj"),
      name: cleanName,
      updatedAt: new Date().toISOString(),
      layerCount: scene.layers.length,
      file: createSceneFile({ ...scene, name: cleanName }),
    };
    const others = records.filter((r) => r.id !== record.id);
    if (others.length >= MAX_PROJECTS) return { ok: false, error: `The library holds up to ${MAX_PROJECTS} projects — delete one first.` };
    writeRecords(store, [record, ...others]);
    return { ok: true, value: summary(record) };
  } catch (e) {
    return { ok: false, error: isQuotaError(e) ? "Browser storage is full — delete projects or export them as files." : "The project could not be saved." };
  }
}

export function loadProject(id: string, store: Storage | null = browserStorage()): Result<{ scene: SceneConfig; warnings: string[]; name: string }> {
  if (!store) return { ok: false, error: UNAVAILABLE };
  try {
    const record = readRecords(store).find((r) => r.id === id);
    if (!record) return { ok: false, error: "That project no longer exists." };
    const parsed = parseSceneFile(record.file);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    return { ok: true, value: { scene: parsed.scene, warnings: parsed.warnings, name: record.name } };
  } catch {
    return { ok: false, error: "The project could not be read." };
  }
}

export function deleteProject(id: string, store: Storage | null = browserStorage()): Result<true> {
  if (!store) return { ok: false, error: UNAVAILABLE };
  try {
    writeRecords(store, readRecords(store).filter((r) => r.id !== id));
    return { ok: true, value: true };
  } catch {
    return { ok: false, error: "The project could not be deleted." };
  }
}

"use client";

/**
 * Toolbar control (button + popover): save to the browser project library,
 * open/delete saved projects, export/import .vanta.json files, copy a share
 * link and start a new scene. All storage access is guarded (see library.ts).
 */
import { useRef, useState } from "react";
import { Download, FilePlus2, FolderOpen, Link2, Save, Trash2, Upload } from "lucide-react";
import { Button, Notice, Popover, cx } from "@/components/ui/primitives";
import { SCENE_FILE_EXTENSION, createSceneFile, parseSceneFile } from "@/shared/scene/file";
import { DEFAULT_PRESET_ID } from "@/shared/scene/presets";
import { useSceneStore } from "@/store/sceneStore";
import { deleteProject, listProjects, loadProject, saveProject, type ProjectSummary } from "../library";
import { buildShareUrl } from "../shareLink";

const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
type Feedback = { tone: "success" | "warning" | "danger"; text: string; detail?: string } | null;

function relativeTime(iso: string): string {
  const diff = Date.now() - Date.parse(iso);
  if (!Number.isFinite(diff)) return "";
  const min = Math.round(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(iso).toLocaleDateString();
}

function fileSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "scene";
}

export function ProjectMenu() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [name, setName] = useState("");
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = () => {
    const result = listProjects();
    if (result.ok) setProjects(result.value);
    else setFeedback({ tone: "danger", text: result.error });
  };

  const onOpen = () => {
    setName(useSceneStore.getState().scene.name);
    setConfirmDelete(null);
    setFeedback(null);
    refresh();
  };

  const save = (asNew: boolean) => {
    const scene = useSceneStore.getState().scene;
    const result = saveProject(scene, name || scene.name, asNew ? null : currentId);
    if (!result.ok) return setFeedback({ tone: "danger", text: result.error });
    setCurrentId(result.value.id);
    if (result.value.name !== scene.name) useSceneStore.getState().renameScene(result.value.name);
    setFeedback({ tone: "success", text: `Saved “${result.value.name}”.` });
    refresh();
  };

  const open = (id: string) => {
    const result = loadProject(id);
    if (!result.ok) return setFeedback({ tone: "danger", text: result.error });
    const applied = useSceneStore.getState().setScene(result.value.scene, { source: "import", resetHistory: false });
    if (!applied.ok) return setFeedback({ tone: "danger", text: "The project could not be loaded." });
    setCurrentId(id);
    setName(result.value.name);
    const warnings = [...result.value.warnings, ...applied.warnings];
    setFeedback(warnings.length ? { tone: "warning", text: `Opened “${result.value.name}” with ${warnings.length} repairs.`, detail: warnings.slice(0, 4).join(" · ") } : { tone: "success", text: `Opened “${result.value.name}”.` });
  };

  const remove = (id: string) => {
    if (confirmDelete !== id) return setConfirmDelete(id);
    const result = deleteProject(id);
    setConfirmDelete(null);
    if (!result.ok) return setFeedback({ tone: "danger", text: result.error });
    if (currentId === id) setCurrentId(null);
    setFeedback({ tone: "success", text: "Project deleted." });
    refresh();
  };

  const exportFile = () => {
    try {
      const scene = useSceneStore.getState().scene;
      const blob = new Blob([JSON.stringify(createSceneFile(scene), null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${fileSlug(scene.name)}${SCENE_FILE_EXTENSION}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setFeedback({ tone: "success", text: `Exported ${a.download}.` });
    } catch {
      setFeedback({ tone: "danger", text: "The scene could not be exported." });
    }
  };

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) return setFeedback({ tone: "danger", text: "That file is too large to be a VANTA scene (max 2 MB)." });
    try {
      const parsed = parseSceneFile(JSON.parse(await file.text()));
      if (!parsed.ok) return setFeedback({ tone: "danger", text: parsed.error });
      const applied = useSceneStore.getState().setScene(parsed.scene, { source: "import", resetHistory: false });
      if (!applied.ok) return setFeedback({ tone: "danger", text: "The scene could not be loaded." });
      setCurrentId(null);
      const warnings = [...parsed.warnings, ...applied.warnings];
      setFeedback(warnings.length ? { tone: "warning", text: `Imported “${parsed.scene.name}” with ${warnings.length} repairs.`, detail: warnings.slice(0, 4).join(" · ") } : { tone: "success", text: `Imported “${parsed.scene.name}”.` });
    } catch {
      setFeedback({ tone: "danger", text: "That file is not valid JSON." });
    } finally {
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const copyShareLink = async () => {
    try {
      const result = await buildShareUrl(useSceneStore.getState().scene, window.location.href);
      if (!result.ok) return setFeedback({ tone: "danger", text: result.error });
      try {
        await navigator.clipboard.writeText(result.url);
        setFeedback({ tone: "success", text: `Share link copied (${Math.ceil(result.url.length / 1024)} KB).` });
      } catch {
        setFeedback({ tone: "warning", text: "Clipboard unavailable — copy the link below.", detail: result.url });
      }
    } catch {
      setFeedback({ tone: "danger", text: "The share link could not be created." });
    }
  };

  const newScene = () => {
    useSceneStore.getState().loadPreset(DEFAULT_PRESET_ID);
    setCurrentId(null);
    setName(useSceneStore.getState().scene.name);
    setFeedback({ tone: "success", text: "Started a new scene (undo to go back)." });
  };

  return (
    <>
      <input ref={fileInput} type="file" accept=".json,application/json" className="hidden" onChange={(e) => void importFile(e.target.files?.[0])} />
      <Popover
        align="end"
        className="w-80"
        trigger={({ open, toggle }) => (
          <Button
            variant="ghost"
            size="sm"
            active={open}
            aria-haspopup="dialog"
            aria-expanded={open}
            onClick={() => {
              if (!open) onOpen();
              toggle();
            }}
          >
            <FolderOpen size={14} />
            Project
          </Button>
        )}
      >
        <div className="flex flex-col gap-3 p-1">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="vanta-project-name" className="text-[10px] font-semibold uppercase tracking-[0.14em] text-fg-faint">
              Save to browser
            </label>
            <div className="flex gap-1.5">
              <input
                id="vanta-project-name"
                value={name}
                maxLength={48}
                placeholder="Project name"
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && save(false)}
                className="h-7 min-w-0 flex-1 rounded-md bg-surface-3 px-2 text-xs text-fg outline-none ring-1 ring-line focus:ring-violet/60"
              />
              <Button variant="primary" size="sm" onClick={() => save(false)} title={currentId ? "Overwrite the open project" : "Save as a new project"}>
                <Save size={13} />
                Save
              </Button>
            </div>
            {currentId ? (
              <button type="button" className="self-start text-[11px] text-fg-muted underline-offset-2 hover:text-fg hover:underline" onClick={() => save(true)}>
                Save as new copy
              </button>
            ) : null}
          </div>

          <div className="flex flex-col gap-1">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-fg-faint">Saved projects</div>
            {projects.length === 0 ? (
              <div className="rounded-md border border-dashed border-line px-2.5 py-3 text-center text-[11px] text-fg-faint">No saved projects yet.</div>
            ) : (
              <ul className="max-h-56 overflow-y-auto rounded-md ring-1 ring-line">
                {projects.map((p) => (
                  <li key={p.id} className={cx("group flex items-center gap-2 border-b border-line px-2 py-1.5 last:border-b-0", p.id === currentId && "bg-violet/10")}>
                    <button type="button" className="min-w-0 flex-1 text-left" onClick={() => open(p.id)} title={`Open “${p.name}”`}>
                      <div className="truncate text-xs text-fg">{p.name}</div>
                      <div className="text-[10px] text-fg-faint">
                        {relativeTime(p.updatedAt)} · {p.layerCount} {p.layerCount === 1 ? "layer" : "layers"}
                      </div>
                    </button>
                    <Button variant={confirmDelete === p.id ? "danger" : "ghost"} size="xs" icon={confirmDelete !== p.id} aria-label={`Delete ${p.name}`} onClick={() => remove(p.id)}>
                      {confirmDelete === p.id ? "Delete?" : <Trash2 size={12} />}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            <Button size="sm" onClick={() => fileInput.current?.click()}>
              <Upload size={13} />
              Import file
            </Button>
            <Button size="sm" onClick={exportFile}>
              <Download size={13} />
              Export file
            </Button>
            <Button size="sm" onClick={() => void copyShareLink()}>
              <Link2 size={13} />
              Share link
            </Button>
            <Button size="sm" onClick={newScene}>
              <FilePlus2 size={13} />
              New scene
            </Button>
          </div>

          {feedback ? (
            <Notice tone={feedback.tone}>
              <div role="status">{feedback.text}</div>
              {feedback.detail ? <div className="mt-1 max-h-20 overflow-y-auto break-all font-mono text-[10px] opacity-80">{feedback.detail}</div> : null}
            </Notice>
          ) : null}
        </div>
      </Popover>
    </>
  );
}

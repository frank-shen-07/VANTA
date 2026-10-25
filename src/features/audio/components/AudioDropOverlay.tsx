"use client";

/**
 * Window-level drag-and-drop for MP3/WAV files. Shows a full-window drop target
 * while files are dragged over the studio; rejects non-audio with a message.
 */
import { AudioLines, CircleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { getAudioController } from "@/shared/runtime/registry";
import { validateAudioFile } from "../engine/validation";

export function AudioDropOverlay() {
  const [dragging, setDragging] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let depth = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const flash = (text: string) => {
      setMessage(text);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setMessage(null), 4000);
    };
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      setDragging(true);
    };
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      const check = validateAudioFile(file);
      if (!check.ok) return flash(check.error);
      const controller = getAudioController();
      if (!controller) return flash("The audio engine isn't ready yet.");
      void controller.loadFile(file).catch((err: Error) => flash(err.message));
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  return (
    <>
      {dragging ? (
        <div className="pointer-events-none fixed inset-0 z-[100] flex items-center justify-center bg-surface-0/70 backdrop-blur-sm" data-testid="audio-drop-overlay">
          <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-cyan/50 bg-surface-1/80 px-12 py-10 text-center shadow-[var(--shadow-pop)]">
            <AudioLines size={28} className="text-cyan" />
            <div className="text-sm font-medium text-fg">Drop to load audio</div>
            <div className="text-xs text-fg-muted">MP3 or WAV, up to 200 MB</div>
          </div>
        </div>
      ) : null}
      {message ? (
        <div role="alert" data-testid="audio-drop-error" className="fixed left-1/2 top-16 z-[100] flex max-w-md -translate-x-1/2 items-center gap-2 rounded-lg border border-danger/30 bg-surface-2/95 px-3 py-2 text-xs text-danger shadow-[var(--shadow-pop)]">
          <CircleAlert size={14} className="shrink-0" />
          <span>{message}</span>
        </div>
      ) : null}
    </>
  );
}

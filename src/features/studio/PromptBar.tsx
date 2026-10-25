"use client";

/** AI prompt input for generating / refining scenes. Written by the lead orchestrator during integration. */
import { Loader2, Sparkles } from "lucide-react";
import { useState } from "react";
import { useSceneAI } from "@/features/ai/useSceneAI";
import { Badge, Button, cx } from "@/components/ui/primitives";
import { useSceneStore } from "@/store/sceneStore";

export function PromptBar() {
  const ai = useSceneAI();
  const hasLayers = useSceneStore((s) => s.scene.layers.length > 0);
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<"refine" | "generate">("generate");
  const effectiveMode = hasLayers ? mode : "generate";
  const pending = ai.status === "pending";
  const submit = () => {
    const text = prompt.trim();
    if (!text || pending) return;
    void (effectiveMode === "refine" ? ai.refine(text) : ai.generate(text));
  };
  return (
    <div className="relative flex min-w-0 max-w-2xl flex-1 items-center gap-2">
      <div className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg bg-surface-2 px-2.5 ring-1 ring-line focus-within:ring-violet/60">
        <Sparkles size={14} className="shrink-0 text-violet-soft" />
        <input
          aria-label="Describe a scene"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder={effectiveMode === "refine" ? "Refine: “make the rings faster and more blue”" : "Describe a world: “red cyberpunk tunnel with neon rings that react to bass”"}
          className="min-w-0 flex-1 bg-transparent text-xs text-fg outline-none placeholder:text-fg-faint"
        />
        {ai.llmConfigured === false ? <Badge tone="warning">offline generator</Badge> : null}
        <div className="flex shrink-0 rounded-md bg-surface-3 p-0.5">
          {(["generate", "refine"] as const).map((m) => (
            <button
              key={m}
              type="button"
              disabled={m === "refine" && !hasLayers}
              onClick={() => setMode(m)}
              className={cx("h-5 rounded px-1.5 text-[10px] font-medium", effectiveMode === m ? "bg-violet/25 text-violet-soft" : "text-fg-muted hover:text-fg")}
            >
              {m === "generate" ? "New" : "Refine"}
            </button>
          ))}
        </div>
      </div>
      {pending ? (
        <Button variant="secondary" size="sm" onClick={ai.cancel}>
          <Loader2 size={13} className="animate-spin" /> Cancel
        </Button>
      ) : (
        <Button variant="primary" size="sm" onClick={submit} disabled={!prompt.trim()}>
          Generate
        </Button>
      )}
      {ai.error || ai.lastResult ? (
        <div className={cx("absolute left-0 top-full z-40 mt-2 flex max-w-xl items-start gap-2 rounded-lg bg-surface-2/95 px-3 py-2 text-[11px] shadow-[var(--shadow-pop)]", ai.error ? "text-danger" : "text-fg-muted")}>
          <span className="min-w-0 flex-1">
            {ai.error ?? ai.lastResult?.summary}
            {!ai.error && ai.lastResult?.warnings.length ? <span className="text-fg-faint"> · {ai.lastResult.warnings.length} adjustments</span> : null}
          </span>
        </div>
      ) : null}
      {ai.suggestions.length > 0 && !prompt ? (
        <div className="hidden xl:flex items-center gap-1">
          {ai.suggestions.slice(0, 2).map((s) => (
            <Button key={s.id} variant="accent" size="xs" title={s.reason} onClick={() => setPrompt(s.prompt)}>
              {s.label}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

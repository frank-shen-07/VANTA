"use client";

/**
 * Bottom music bar: source loading (file / URL / microphone / SoundCloud),
 * transport, seek, volume, analysis status and live feature meters.
 * Per-frame visuals (progress, meters) are driven by rAF + direct DOM writes;
 * React state only changes with the ≤10 Hz controller snapshots.
 */
import {
  AudioLines,
  ChevronUp,
  CircleAlert,
  Cloud,
  Link2,
  LoaderCircle,
  Mic,
  Pause,
  Play,
  Power,
  RotateCcw,
  Upload,
  Volume2,
  VolumeX,
  Workflow,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { Badge, Button, Popover, cx } from "@/components/ui/primitives";
import type { AudioController, AudioControllerState } from "@/shared/audio/contract";
import { audioBus } from "@/shared/runtime/audioBus";
import { getAudioController } from "@/shared/runtime/registry";
import { useEditorStore } from "@/store/editorStore";
import { isAudioEngine } from "../engine/AudioEngine";
import { fileExtension, formatBytes } from "../engine/validation";
import { useAudioController, useAudioState } from "../hooks";

export interface AudioPlayerBarProps {
  className?: string;
}

export const AUDIO_FILE_ACCEPT = ".mp3,.wav,audio/mpeg,audio/wav";

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

function currentTimeOf(controller: AudioController | null): number {
  if (!controller) return 0;
  return isAudioEngine(controller) ? controller.getCurrentTime() : controller.getState().currentTime;
}

function sourceMeta(state: AudioControllerState): string {
  const src = state.source;
  if (!src) return "";
  const parts: string[] = [];
  switch (src.kind) {
    case "file": {
      const ext = fileExtension(src.label).slice(1).toUpperCase();
      parts.push(ext || (src.mimeType?.includes("wav") ? "WAV" : "MP3"));
      if (src.sizeBytes) parts.push(formatBytes(src.sizeBytes));
      break;
    }
    case "url":
      parts.push("URL");
      if (src.url) {
        try {
          parts.push(new URL(src.url).host);
        } catch {
          /* ignore */
        }
      }
      break;
    case "microphone":
      parts.push("Live input · not played back");
      break;
    case "soundcloud":
      parts.push("SoundCloud");
      break;
  }
  if (!state.isLive && state.duration > 0) parts.push(formatTime(state.duration));
  return parts.join(" · ");
}

/* ------------------------------------------------------------------ */
/* Main bar                                                            */
/* ------------------------------------------------------------------ */

export function AudioPlayerBar({ className }: AudioPlayerBarProps) {
  const controller = useAudioController();
  const state = useAudioState();
  const fileInput = useRef<HTMLInputElement>(null);
  const bottomPanel = useEditorStore((s) => s.bottomPanel);
  const { status, source } = state;
  const hasSource = !!source;
  const loading = status === "loading";
  const playing = status === "playing";

  const openFilePicker = () => fileInput.current?.click();
  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file && controller) void controller.loadFile(file).catch(() => {});
  };

  return (
    <div
      data-testid="audio-player-bar"
      className={cx(
        "relative grid h-16 w-full shrink-0 grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_minmax(0,1fr)] items-center gap-4 border-t border-line bg-surface-1/95 px-3 backdrop-blur",
        className,
      )}
    >
      <input ref={fileInput} type="file" accept={AUDIO_FILE_ACCEPT} className="hidden" onChange={onFile} data-testid="audio-file-input" aria-label="Upload audio file" />

      {/* Source + track info */}
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex items-center rounded-lg bg-surface-2 ring-1 ring-line">
          <Button
            variant={hasSource ? "ghost" : "primary"}
            size="sm"
            icon={hasSource}
            onClick={openFilePicker}
            title="Upload MP3 or WAV"
            aria-label="Upload MP3 or WAV"
            className={hasSource ? "rounded-r-none" : "rounded-r-none px-2.5"}
          >
            <Upload size={14} />
            {hasSource ? null : <span>Load audio</span>}
          </Button>
          <Popover
            side="top"
            align="start"
            trigger={({ open, toggle }) => (
              <Button variant="ghost" size="sm" icon onClick={toggle} active={open} aria-label="Audio sources" title="Audio sources" className="rounded-l-none">
                <ChevronUp size={14} className={cx("transition-transform", open ? "" : "rotate-180")} />
              </Button>
            )}
          >
            {(close) => <SourceMenu controller={controller} state={state} close={close} openFilePicker={openFilePicker} />}
          </Popover>
        </div>
        <TrackInfo state={state} controller={controller} />
      </div>

      {/* Transport + seek */}
      <div className="flex min-w-0 items-center gap-2.5">
        <Button variant="ghost" size="sm" icon disabled={!hasSource || loading || state.isLive} onClick={() => controller && void controller.restart()} title="Restart" aria-label="Restart">
          <RotateCcw size={14} />
        </Button>
        <button
          type="button"
          data-testid="audio-play-toggle"
          disabled={!hasSource || loading}
          onClick={() => controller && void controller.togglePlay()}
          aria-label={playing ? "Pause" : "Play"}
          title={playing ? "Pause" : "Play"}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-fg text-surface-0 shadow-[0_0_0_1px_rgb(255_255_255/0.1),0_6px_18px_-6px_rgb(139_92_246/0.7)] transition-[transform,opacity] hover:scale-105 active:scale-95 disabled:pointer-events-none disabled:opacity-30"
        >
          {loading ? <LoaderCircle size={16} className="animate-spin" /> : playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" className="translate-x-px" />}
        </button>
        {state.isLive ? <LiveIndicator paused={!playing} /> : <SeekBar controller={controller} state={state} />}
      </div>

      {/* Meters, volume, node graph */}
      <div className="flex min-w-0 items-center justify-end gap-3">
        <LiveMeters active={hasSource && source.analysis === "available"} />
        <VolumeControl controller={controller} state={state} />
        <Button
          size="sm"
          variant="ghost"
          active={bottomPanel === "nodes"}
          onClick={() => useEditorStore.getState().setBottomPanel(bottomPanel === "nodes" ? "none" : "nodes")}
          title="Toggle node graph"
          aria-pressed={bottomPanel === "nodes"}
          data-testid="toggle-node-graph"
        >
          <Workflow size={14} />
          <span className="hidden xl:inline">Nodes</span>
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Track info, badge, errors                                           */
/* ------------------------------------------------------------------ */

function TrackInfo({ state, controller }: { state: AudioControllerState; controller: AudioController | null }) {
  const { source, error, status } = state;
  const dismiss = () => {
    if (isAudioEngine(controller)) controller.clearError();
  };
  if (!source) {
    return (
      <div className="min-w-0 leading-tight">
        {error ? (
          <ErrorLine message={error} onDismiss={dismiss} />
        ) : (
          <>
            <div className="truncate text-xs text-fg-muted">{status === "loading" ? "Loading…" : "No audio loaded"}</div>
            <div className="truncate text-[11px] text-fg-faint">Drop an MP3 or WAV anywhere, or pick a source</div>
          </>
        )}
      </div>
    );
  }
  const playbackOnly = source.analysis === "unavailable";
  return (
    <div className="min-w-0 flex-1 leading-tight" data-testid="audio-track-info">
      <div className="flex min-w-0 items-center gap-1.5">
        <SourceIcon kind={source.kind} />
        <span className="truncate text-xs font-medium text-fg" title={source.label}>
          {source.label}
        </span>
        {status === "loading" ? null : playbackOnly ? (
          <Badge tone="warning" className="shrink-0">
            <span title={source.analysisNote}>Playback only</span>
          </Badge>
        ) : (
          <Badge tone="cyan" className="shrink-0">
            <span className={cx("h-1.5 w-1.5 rounded-full bg-cyan", status === "playing" && "animate-pulse")} />
            Live analysis
          </Badge>
        )}
      </div>
      {error ? (
        <ErrorLine message={error} onDismiss={dismiss} />
      ) : playbackOnly ? (
        <div className="truncate text-[11px] text-warning/80" title={source.analysisNote} data-testid="analysis-note">
          {source.analysisNote}
        </div>
      ) : (
        <div className="truncate font-mono text-[10.5px] text-fg-faint">{sourceMeta(state)}</div>
      )}
    </div>
  );
}

function ErrorLine({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="flex min-w-0 items-center gap-1 text-[11px] text-danger" role="alert" data-testid="audio-error">
      <CircleAlert size={12} className="shrink-0" />
      <span className="truncate" title={message}>
        {message}
      </span>
      <button type="button" onClick={onDismiss} className="shrink-0 rounded p-0.5 text-danger/70 hover:bg-danger/10 hover:text-danger" aria-label="Dismiss error">
        <X size={11} />
      </button>
    </div>
  );
}

function SourceIcon({ kind }: { kind: NonNullable<AudioControllerState["source"]>["kind"] }) {
  const cls = "shrink-0 text-fg-faint";
  if (kind === "microphone") return <Mic size={12} className={cls} />;
  if (kind === "soundcloud") return <Cloud size={12} className={cls} />;
  if (kind === "url") return <Link2 size={12} className={cls} />;
  return <AudioLines size={12} className={cls} />;
}

/* ------------------------------------------------------------------ */
/* Source menu                                                         */
/* ------------------------------------------------------------------ */

function MenuItem({ icon, label, hint, onClick, disabled, danger }: { icon: React.ReactNode; label: string; hint?: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cx(
        "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-surface-3 disabled:pointer-events-none disabled:opacity-40",
        danger ? "text-danger" : "text-fg",
      )}
    >
      <span className={cx("flex h-6 w-6 shrink-0 items-center justify-center rounded-md ring-1", danger ? "bg-danger/10 ring-danger/20" : "bg-surface-3 ring-line")}>{icon}</span>
      <span className="min-w-0">
        <span className="block text-xs">{label}</span>
        {hint ? <span className="block truncate text-[10.5px] text-fg-faint">{hint}</span> : null}
      </span>
    </button>
  );
}

function SourceMenu({ controller, state, close, openFilePicker }: { controller: AudioController | null; state: AudioControllerState; close: () => void; openFilePicker: () => void }) {
  const [mode, setMode] = useState<"menu" | "url" | "soundcloud">("menu");
  const [value, setValue] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!controller || !value.trim()) return;
    const run = mode === "soundcloud" ? controller.loadSoundCloud(value) : controller.loadUrl(value);
    void run.catch(() => {});
    close();
  };
  if (mode !== "menu") {
    const sc = mode === "soundcloud";
    return (
      <form className="w-80 space-y-2 p-1" onSubmit={submit}>
        <div className="flex items-center gap-2 text-xs font-medium text-fg">
          {sc ? <Cloud size={13} /> : <Link2 size={13} />}
          {sc ? "SoundCloud link" : "Audio URL"}
        </div>
        <input
          autoFocus
          type="url"
          required
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={sc ? "https://soundcloud.com/artist/track" : "https://example.com/track.mp3"}
          className="h-8 w-full rounded-md bg-surface-3 px-2 text-xs text-fg outline-none ring-1 ring-line placeholder:text-fg-faint focus:ring-violet/60"
          data-testid={sc ? "soundcloud-url-input" : "audio-url-input"}
        />
        <p className="text-[10.5px] leading-relaxed text-fg-faint">
          {sc
            ? "Plays through SoundCloud's official widget. Its audio isn't accessible to Web Audio, so visuals won't react."
            : "Direct link to an MP3/WAV. Analysis needs the server to allow CORS; otherwise it plays back without reactivity."}
        </p>
        <div className="flex justify-end gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => setMode("menu")}>
            Back
          </Button>
          <Button size="sm" variant="primary" type="submit" disabled={!value.trim()}>
            Load
          </Button>
        </div>
      </form>
    );
  }
  return (
    <div className="w-72 space-y-0.5" data-testid="audio-source-menu">
      <div className="px-2 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-fg-faint">Audio source</div>
      <MenuItem
        icon={<Upload size={13} />}
        label="Upload MP3 / WAV"
        hint="Up to 200 MB · or drop a file anywhere"
        onClick={() => {
          close();
          openFilePicker();
        }}
      />
      <MenuItem icon={<Link2 size={13} />} label="Audio URL" hint="Direct link to an MP3/WAV file" onClick={() => setMode("url")} />
      <MenuItem
        icon={<Mic size={13} />}
        label="Microphone"
        hint="Live input, analysed but not played back"
        onClick={() => {
          close();
          if (controller) void controller.startMicrophone().catch(() => {});
        }}
      />
      <MenuItem icon={<Cloud size={13} />} label="SoundCloud" hint="Playback only — no audio analysis" onClick={() => setMode("soundcloud")} />
      <div className="my-1 h-px bg-line" />
      <MenuItem
        icon={<Power size={13} />}
        label="Unload source"
        danger
        disabled={!state.source && state.status !== "error"}
        onClick={() => {
          close();
          controller?.unload();
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Seek bar (rAF-driven progress)                                      */
/* ------------------------------------------------------------------ */

function SeekBar({ controller, state }: { controller: AudioController | null; state: AudioControllerState }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const dragRef = useRef<number | null>(null);
  const durationRef = useRef(state.duration);
  const duration = state.duration;
  const disabled = !state.source || duration <= 0 || state.status === "loading";

  useEffect(() => {
    durationRef.current = duration;
  }, [duration]);

  useEffect(() => {
    let raf = 0;
    let lastText = "";
    const tick = () => {
      const d = durationRef.current;
      const t = dragRef.current !== null ? dragRef.current * d : currentTimeOf(getAudioController());
      const frac = d > 0 ? Math.min(1, Math.max(0, t / d)) : 0;
      if (fillRef.current) fillRef.current.style.transform = `scaleX(${frac})`;
      if (thumbRef.current) thumbRef.current.style.left = `${frac * 100}%`;
      const text = formatTime(t);
      if (text !== lastText && timeRef.current) {
        timeRef.current.textContent = text;
        trackRef.current?.setAttribute("aria-valuenow", String(Math.round(t)));
        trackRef.current?.setAttribute("aria-valuetext", `${text} of ${formatTime(d)}`);
        lastText = text;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const fractionAt = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return 0;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  };
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = fractionAt(e.clientX);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current !== null) dragRef.current = fractionAt(e.clientX);
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current === null) return;
    const frac = fractionAt(e.clientX);
    dragRef.current = null;
    controller?.seek(frac * durationRef.current);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled || !controller) return;
    const t = currentTimeOf(controller);
    const step = e.shiftKey ? 1 : 5;
    let next: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") next = t + step;
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = t - step;
    else if (e.key === "PageUp") next = t + duration * 0.1;
    else if (e.key === "PageDown") next = t - duration * 0.1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = Math.max(0, duration - 0.05);
    if (next === null) return;
    e.preventDefault();
    controller.seek(Math.max(0, Math.min(duration, next)));
  };

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <span ref={timeRef} className="w-10 shrink-0 text-right font-mono text-[10.5px] tabular-nums text-fg-muted">
        0:00
      </span>
      <div
        ref={trackRef}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={0}
        aria-disabled={disabled}
        data-testid="audio-seek"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (dragRef.current = null)}
        onKeyDown={onKeyDown}
        className={cx(
          "group relative flex h-6 min-w-0 flex-1 items-center outline-none",
          disabled ? "cursor-default opacity-40" : "cursor-pointer",
        )}
      >
        <div className="relative h-1 w-full overflow-hidden rounded-full bg-surface-4 transition-[height] group-hover:h-1.5 group-focus-visible:h-1.5">
          <div ref={fillRef} className="absolute inset-0 origin-left rounded-full bg-gradient-to-r from-violet to-cyan" style={{ transform: "scaleX(0)" }} />
        </div>
        <div
          ref={thumbRef}
          className="pointer-events-none absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-fg opacity-0 shadow ring-2 ring-violet/60 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
          style={{ left: "0%" }}
        />
      </div>
      <span className="w-10 shrink-0 font-mono text-[10.5px] tabular-nums text-fg-faint">{formatTime(duration)}</span>
    </div>
  );
}

function LiveIndicator({ paused }: { paused: boolean }) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 text-[11px]">
      <span className={cx("h-2 w-2 shrink-0 rounded-full", paused ? "bg-fg-faint" : "animate-pulse bg-danger shadow-[0_0_10px_rgb(244_63_94/0.8)]")} />
      <span className={cx("font-semibold tracking-[0.18em]", paused ? "text-fg-faint" : "text-danger")}>LIVE</span>
      <span className="truncate text-fg-faint">{paused ? "Analysis paused" : "Microphone analysis running"}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Live meters (rAF + direct DOM writes)                               */
/* ------------------------------------------------------------------ */

const METERS = [
  { key: "bass", label: "B", title: "Bass 20–250 Hz", color: "bg-violet" },
  { key: "mids", label: "M", title: "Mids 250 Hz–2 kHz", color: "bg-violet-soft" },
  { key: "highs", label: "H", title: "Highs 2–16 kHz", color: "bg-cyan" },
  { key: "energy", label: "E", title: "Energy (RMS)", color: "bg-cyan-soft" },
  { key: "onset", label: "O", title: "Onset / beat", color: "bg-fg" },
] as const;

function LiveMeters({ active }: { active: boolean }) {
  const bars = useRef<(HTMLDivElement | null)[]>([]);
  useEffect(() => {
    let raf = 0;
    const last = [-1, -1, -1, -1, -1];
    const tick = () => {
      const f = audioBus.features;
      for (let i = 0; i < METERS.length; i++) {
        const v = Math.round(Math.min(1, Math.max(0, f[METERS[i].key])) * 100) / 100;
        const el = bars.current[i];
        if (el && v !== last[i]) {
          el.style.transform = `scaleY(${Math.max(0.04, v)})`;
          el.style.opacity = String(0.35 + v * 0.65);
          last[i] = v;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div
      className={cx("hidden items-end gap-1 lg:flex", !active && "opacity-40")}
      title={active ? "Live audio features" : "No live analysis"}
      data-testid="audio-meters"
      aria-hidden
    >
      {METERS.map((m, i) => (
        <div key={m.key} className="flex flex-col items-center gap-0.5" title={m.title}>
          <div className="relative h-6 w-1.5 overflow-hidden rounded-sm bg-surface-3">
            <div
              ref={(el) => {
                bars.current[i] = el;
              }}
              className={cx("absolute inset-0 origin-bottom rounded-sm", m.color)}
              style={{ transform: "scaleY(0.04)", opacity: 0.35 }}
            />
          </div>
          <span className="font-mono text-[8.5px] leading-none text-fg-faint">{m.label}</span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Volume                                                              */
/* ------------------------------------------------------------------ */

function VolumeControl({ controller, state }: { controller: AudioController | null; state: AudioControllerState }) {
  const { volume, muted } = state;
  const shown = muted ? 0 : volume;
  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="sm"
        icon
        onClick={() => controller?.setMuted(!muted)}
        aria-label={muted ? "Unmute" : "Mute"}
        title={muted ? "Unmute" : "Mute"}
        disabled={!controller}
      >
        {muted || volume === 0 ? <VolumeX size={14} /> : <Volume2 size={14} />}
      </Button>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={shown}
        disabled={!controller}
        aria-label="Volume"
        className="vanta-range hidden w-20 sm:block"
        style={{ ["--fill" as string]: `${shown * 100}%` }}
        onChange={(e) => {
          const v = Number(e.target.value);
          controller?.setVolume(v);
          if (muted && v > 0) controller?.setMuted(false);
        }}
      />
    </div>
  );
}

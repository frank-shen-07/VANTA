"use client";

/**
 * Toolbar control: record the live canvas to video (format, fps, quality,
 * audio, max duration), show status/elapsed time, download the result, and
 * save a PNG still.
 */
import { Camera, Circle, Download, Square, Trash2, Video } from "lucide-react";
import { useState } from "react";
import { Button, Notice, Popover, Select, Toggle } from "@/components/ui/primitives";
import { DEFAULT_RECORDING_OPTIONS, type RecordingOptions } from "@/shared/export/contract";
import { useAudioState } from "@/features/audio/hooks";
import { formatBytes } from "@/features/audio/engine/validation";
import { useExportController, useExportState, useRendererHandle } from "../hooks";
import { DURATION_PRESETS, QUALITY_PRESETS, formatDuration } from "../recorder";
import { audioUnavailableReason } from "../VideoExporter";

export function ExportMenu() {
  const controller = useExportController();
  const state = useExportState();
  const renderer = useRendererHandle();
  const audio = useAudioState();
  const [options, setOptions] = useState<RecordingOptions>(DEFAULT_RECORDING_OPTIONS);
  const recording = state.status === "recording" || state.status === "finalizing" || state.status === "preparing";
  const supported = controller?.isSupported() ?? false;
  const formats = controller?.getSupportedFormats() ?? [];
  const audioReason = audio.source ? audioUnavailableReason() : "No audio source is loaded.";

  const start = () => controller && void controller.start(options).catch(() => {});
  const stop = () => controller && void controller.stop().catch(() => {});

  return (
    <Popover
      align="end"
      trigger={({ toggle, open }) => (
        <Button variant={recording ? "danger" : "secondary"} size="sm" onClick={toggle} active={open && !recording} data-testid="export-menu-trigger">
          {recording ? <span className="h-2 w-2 animate-pulse rounded-full bg-danger" /> : <Video size={14} />}
          {recording ? <span className="font-mono tabular-nums">{formatDuration(state.elapsedMs)}</span> : "Export"}
        </Button>
      )}
    >
      <div className="w-72 space-y-2.5 p-1" data-testid="export-menu">
        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-fg-faint">Record video</div>
        {!supported ? <Notice tone="danger">Video recording isn&apos;t supported in this browser (needs MediaRecorder + canvas.captureStream).</Notice> : null}
        {!renderer ? <Notice tone="warning">The viewport isn&apos;t ready yet.</Notice> : null}
        <Select
          label="Format"
          value={options.formatId ?? formats[0]?.id ?? ""}
          options={formats.map((f) => ({ value: f.id, label: f.label }))}
          onChange={(formatId) => setOptions({ ...options, formatId })}
          disabled={recording || formats.length === 0}
        />
        <Select
          label="Frame rate"
          value={String(options.fps)}
          options={[24, 30, 60].map((v) => ({ value: String(v), label: `${v} fps` }))}
          onChange={(v) => setOptions({ ...options, fps: Number(v) as RecordingOptions["fps"] })}
          disabled={recording}
        />
        <Select
          label="Quality"
          value={String(options.videoBitsPerSecond)}
          options={QUALITY_PRESETS.map((q) => ({ value: String(q.bitsPerSecond), label: q.label }))}
          onChange={(v) => setOptions({ ...options, videoBitsPerSecond: Number(v) })}
          disabled={recording}
        />
        <Select
          label="Max length"
          value={String(options.maxDurationSec)}
          options={DURATION_PRESETS.map((s) => ({ value: String(s), label: s < 60 ? `${s} s` : `${s / 60} min` }))}
          onChange={(v) => setOptions({ ...options, maxDurationSec: Number(v) })}
          disabled={recording}
        />
        <Toggle label="Include audio" checked={options.includeAudio && !audioReason} disabled={recording || !!audioReason} hint={audioReason ?? undefined} onChange={(includeAudio) => setOptions({ ...options, includeAudio })} />
        {audioReason ? <p className="text-[10.5px] text-fg-faint">{audioReason}</p> : null}
        {recording ? (
          <Button variant="danger" size="md" className="w-full" onClick={stop} disabled={state.status !== "recording"} data-testid="export-stop">
            <Square size={13} fill="currentColor" /> Stop · {formatDuration(state.elapsedMs)}
          </Button>
        ) : (
          <Button variant="primary" size="md" className="w-full" onClick={start} disabled={!supported || !renderer} data-testid="export-record">
            <Circle size={13} fill="currentColor" className="text-danger" /> Record
          </Button>
        )}
        {state.error ? <Notice tone="danger">{state.error}</Notice> : null}
        {state.status === "recording" && state.audioNote ? <p className="text-[10.5px] text-warning">{state.audioNote}</p> : null}
        {state.result ? (
          <div className="space-y-2 rounded-md bg-surface-3 p-2 ring-1 ring-line" data-testid="export-result">
            <div className="font-mono text-[10.5px] text-fg-muted">
              {formatDuration(state.result.durationMs)} · {formatBytes(state.result.sizeBytes)} · {state.result.hasAudio ? "with audio" : "no audio"}
            </div>
            <div className="flex gap-1.5">
              <Button size="sm" variant="accent" className="flex-1" onClick={() => controller?.download()}>
                <Download size={13} /> Download
              </Button>
              <Button size="sm" variant="ghost" onClick={() => controller?.discard()} aria-label="Discard recording">
                <Trash2 size={13} /> Discard
              </Button>
            </div>
          </div>
        ) : null}
        <div className="h-px bg-line" />
        <Button size="sm" variant="secondary" className="w-full" disabled={!renderer} onClick={() => controller && void controller.downloadStill().catch(() => {})}>
          <Camera size={13} /> Save still (PNG)
        </Button>
      </div>
    </Popover>
  );
}

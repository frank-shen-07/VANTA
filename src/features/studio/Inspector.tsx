"use client";

/**
 * Properties inspector, generated from the shared field registry so every
 * schema property is editable. Written by the lead orchestrator during integration.
 */
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button, ColorInput, Select, Slider, SectionHeader, Toggle, cx } from "@/components/ui/primitives";
import {
  AUDIO_BANDS,
  LAYER_TYPES,
  LAYER_TYPE_INFO,
  SCENE_FIELDS,
  fieldsForLayerType,
  type FieldSpec,
  type Layer,
  type LayerType,
  type MappingTarget,
} from "@/shared/scene";
import { getAtPath } from "@/shared/utils/object";
import { selectSelectedLayer, useSceneStore } from "@/store/sceneStore";

function FieldControl({ spec, value, onChange }: { spec: Pick<FieldSpec, "label" | "control" | "hint">; value: unknown; onChange: (path: string | null, v: unknown) => void }) {
  const c = spec.control;
  switch (c.kind) {
    case "slider":
      return <Slider label={spec.label} hint={spec.hint} value={Number(value)} min={c.min} max={c.max} step={c.step} unit={c.unit} onChange={(v) => onChange(null, v)} />;
    case "color":
      return <ColorInput label={spec.label} value={String(value)} onChange={(v) => onChange(null, v)} />;
    case "toggle":
      return <Toggle label={spec.label} hint={spec.hint} checked={Boolean(value)} onChange={(v) => onChange(null, v)} />;
    case "select":
      return <Select label={spec.label} value={String(value)} options={c.options} onChange={(v) => onChange(null, v)} />;
    case "vec3": {
      const vec = value as [number, number, number];
      return (
        <div className="flex flex-col gap-1">
          <span className="text-[11px] text-fg-muted">{spec.label}</span>
          {(["X", "Y", "Z"] as const).map((axis, i) => (
            <Slider key={axis} label={axis} value={vec[i]} min={c.min} max={c.max} step={c.step} unit={c.unit} onChange={(v) => onChange(String(i), v)} />
          ))}
        </div>
      );
    }
  }
}

function groupBy<T extends { group: string }>(items: readonly T[]): [string, T[]][] {
  const map = new Map<string, T[]>();
  for (const item of items) map.set(item.group, [...(map.get(item.group) ?? []), item]);
  return [...map.entries()];
}

function LayerInspector({ layer }: { layer: Layer }) {
  const setLayerField = useSceneStore((s) => s.setLayerField);
  const addMapping = useSceneStore((s) => s.addMapping);
  const updateMapping = useSceneStore((s) => s.updateMapping);
  const removeMapping = useSceneStore((s) => s.removeMapping);
  const removeLayer = useSceneStore((s) => s.removeLayer);
  const targets = LAYER_TYPE_INFO[layer.type].targets;
  return (
    <>
      <div className="flex items-center justify-between px-3 py-2">
        <div className="min-w-0">
          <div className="truncate text-xs font-medium text-fg">{layer.name}</div>
          <div className="text-[10px] uppercase tracking-wider text-fg-faint">{LAYER_TYPE_INFO[layer.type].label}</div>
        </div>
        <Button variant="ghost" size="sm" icon aria-label="Delete layer" title="Delete layer" onClick={() => removeLayer(layer.id)}>
          <Trash2 size={13} />
        </Button>
      </div>
      {groupBy(fieldsForLayerType(layer.type)).map(([group, specs]) => (
        <section key={group} className="border-t border-line pb-2">
          <SectionHeader title={group} />
          <div className="flex flex-col gap-2.5 px-3">
            {specs.map((spec) => (
              <FieldControl key={spec.path} spec={spec} value={getAtPath(layer, spec.path)} onChange={(sub, v) => setLayerField(layer.id, sub ? `${spec.path}.${sub}` : spec.path, v)} />
            ))}
          </div>
        </section>
      ))}
      <section className="border-t border-line pb-3">
        <SectionHeader
          title="Audio reactivity"
          actions={
            <Button variant="ghost" size="xs" onClick={() => addMapping(layer.id, { target: targets[0] })} disabled={layer.reactivity.length >= 6}>
              <Plus size={12} /> Add
            </Button>
          }
        />
        <div className="flex flex-col gap-2 px-3">
          {layer.reactivity.length === 0 ? <p className="text-[11px] text-fg-faint">No mappings — this layer ignores the music.</p> : null}
          {layer.reactivity.map((m) => (
            <div key={m.id} className={cx("flex flex-col gap-2 rounded-md border border-line bg-surface-2 p-2", !m.enabled && "opacity-50")}>
              <div className="flex items-center gap-1.5">
                <Select value={m.source} options={AUDIO_BANDS.map((b) => ({ value: b, label: b }))} onChange={(v) => updateMapping(layer.id, m.id, { source: v })} className="flex-1" />
                <span className="text-[10px] text-fg-faint">→</span>
                <Select value={m.target} options={targets.map((t) => ({ value: t, label: t }))} onChange={(v) => updateMapping(layer.id, m.id, { target: v as MappingTarget })} className="flex-1" />
                <Toggle checked={m.enabled} onChange={(v) => updateMapping(layer.id, m.id, { enabled: v })} />
                <Button variant="ghost" size="xs" icon aria-label="Remove mapping" onClick={() => removeMapping(layer.id, m.id)}>
                  <Trash2 size={11} />
                </Button>
              </div>
              <Slider label="Amount" value={m.amount} min={-3} max={3} step={0.05} onChange={(v) => updateMapping(layer.id, m.id, { amount: v })} />
              <Slider label="Threshold" value={m.threshold} min={0} max={0.95} step={0.01} onChange={(v) => updateMapping(layer.id, m.id, { threshold: v })} />
              <Slider label="Smoothing" value={m.smoothing} min={0} max={0.99} step={0.01} onChange={(v) => updateMapping(layer.id, m.id, { smoothing: v })} />
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

function SceneInspector() {
  const scene = useSceneStore((s) => s.scene);
  const setSectionField = useSceneStore((s) => s.setSectionField);
  return (
    <>
      {groupBy(SCENE_FIELDS).map(([group, specs]) => (
        <section key={group} className="border-t border-line pb-2 first:border-t-0">
          <SectionHeader title={group} />
          <div className="flex flex-col gap-2.5 px-3">
            {specs.map((spec) => (
              <FieldControl key={`${spec.section}.${spec.path}`} spec={spec} value={getAtPath(scene[spec.section], spec.path)} onChange={(_sub, v) => setSectionField(spec.section, spec.path, v)} />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

export function Inspector() {
  const layer = useSceneStore(selectSelectedLayer);
  const addLayer = useSceneStore((s) => s.addLayer);
  const [tab, setTab] = useState<"layer" | "scene">("layer");
  return (
    <aside className="flex w-[300px] shrink-0 flex-col border-l border-line bg-surface-1">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-line px-2">
        {(["layer", "scene"] as const).map((t) => (
          <Button key={t} variant="ghost" size="xs" active={tab === t} onClick={() => setTab(t)}>
            {t === "layer" ? "Layer" : "Scene"}
          </Button>
        ))}
        <div className="ml-auto">
          <Select<LayerType | "">
            value=""
            options={[{ value: "", label: "+ Add layer" }, ...LAYER_TYPES.map((t) => ({ value: t, label: LAYER_TYPE_INFO[t].label }))]}
            onChange={(t) => t && addLayer(t)}
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-6">
        {tab === "scene" ? <SceneInspector /> : layer ? <LayerInspector key={layer.id} layer={layer} /> : <p className="p-4 text-xs text-fg-faint">Select a layer to edit its properties.</p>}
      </div>
    </aside>
  );
}

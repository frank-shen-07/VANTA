"use client";

/**
 * Live viewport: the single R3F <Canvas>. Runs computeModulation once per
 * frame, registers the RendererHandle and renders scene layers, environment
 * and post-processing. The Canvas is never remounted by layout changes.
 */
import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, ChromaticAberration, EffectComposer, Noise, ToneMapping, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode, type BloomEffect } from "postprocessing";
import { memo, useEffect, useLayoutEffect, useRef } from "react";
import * as THREE from "three";
import { computeModulation, liveModulation } from "@/shared/modulation/engine";
import { Button, Select } from "@/components/ui/primitives";
import { RENDER_QUALITY_SETTINGS, type RenderQuality, type RendererHandle, type RendererStats } from "@/shared/render/contract";
import { audioBus } from "@/shared/runtime/audioBus";
import { getRenderer, registerRenderer } from "@/shared/runtime/registry";
import type { Layer } from "@/shared/scene/schema";
import { useEditorStore } from "@/store/editorStore";
import { getSceneSnapshot, useSceneStore } from "@/store/sceneStore";
import { createLayerObject } from "./objects/createLayerObject";
import { EnvironmentRig } from "./objects/EnvironmentRig";
import type { LayerObject } from "./objects/LayerObject";

function ModulationDriver() {
  useFrame((_, delta) => {
    computeModulation(getSceneSnapshot(), audioBus.features, Math.min(delta, 0.1), liveModulation);
  }, -1);
  return null;
}

function RendererBridge() {
  const get = useThree((s) => s.get);
  const stats = useRef<RendererStats>({ fps: 0, frameMs: 0, drawCalls: 0, triangles: 0, points: 0, width: 0, height: 0, dpr: 1 });
  // Runs first each frame: read the previous frame's totals (all passes), then reset.
  useFrame((state, delta) => {
    const s = stats.current;
    const info = state.gl.info;
    s.frameMs = s.frameMs * 0.9 + delta * 1000 * 0.1;
    s.fps = s.frameMs > 0 ? 1000 / s.frameMs : 0;
    s.drawCalls = info.render.calls;
    s.triangles = info.render.triangles;
    s.points = info.render.points;
    s.width = state.size.width;
    s.height = state.size.height;
    s.dpr = state.viewport.dpr;
    info.reset();
  }, -3);
  useEffect(() => {
    const { gl } = get();
    gl.info.autoReset = false;
    const canvas = gl.domElement;
    const setStatus = useEditorStore.getState().setRendererStatus;
    setStatus("ready");
    const onLost = (e: Event) => {
      e.preventDefault();
      setStatus("context-lost", "The GPU context was lost.");
    };
    const onRestored = () => setStatus("ready");
    canvas.addEventListener("webglcontextlost", onLost);
    canvas.addEventListener("webglcontextrestored", onRestored);
    const handle: RendererHandle = {
      getCanvas: () => canvas,
      captureStill: (options) =>
        new Promise<Blob>((resolve, reject) => {
          requestAnimationFrame(() =>
            requestAnimationFrame(() =>
              canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Capture failed"))), options?.mimeType ?? "image/png", options?.quality),
            ),
          );
        }),
      getStats: () => ({ ...stats.current }),
      getStatus: () => useEditorStore.getState().rendererStatus,
    };
    const unregister = registerRenderer(handle);
    if (process.env.NODE_ENV !== "production") (window as unknown as { __VANTA_RENDERER__?: RendererHandle }).__VANTA_RENDERER__ = handle;
    return () => {
      unregister();
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
    };
  }, [get]);
  return null;
}

/** Background, fog and lights; config applied when the environment object changes. */
function EnvironmentNode() {
  const get = useThree((s) => s.get);
  const rigRef = useRef<EnvironmentRig | null>(null);
  useLayoutEffect(() => {
    const { scene } = get();
    const rig = new EnvironmentRig();
    rigRef.current = rig;
    scene.add(rig.root);
    return () => {
      scene.remove(rig.root);
      rig.dispose(scene);
      rigRef.current = null;
    };
  }, [get]);
  useFrame((state) => {
    const rig = rigRef.current;
    if (!rig) return;
    rig.apply(getSceneSnapshot().environment, state.scene);
    rig.frame(state.camera, state.clock.elapsedTime);
  });
  return null;
}

/** Applies camera config changes and audio-driven shake without fighting OrbitControls. */
function CameraRig() {
  const shake = useRef({ x: 0, y: 0, applied: { fov: -1, distance: -1, height: -999 } });
  // Remove last frame's shake before OrbitControls updates (priority -1).
  useFrame((state) => {
    const s = shake.current;
    state.camera.position.x -= s.x;
    state.camera.position.y -= s.y;
    s.x = 0;
    s.y = 0;
    const cam = getSceneSnapshot().environment.camera;
    const a = s.applied;
    const camera = state.camera as THREE.PerspectiveCamera;
    if (cam.fov !== a.fov) {
      a.fov = cam.fov;
      camera.fov = cam.fov;
      camera.updateProjectionMatrix();
    }
    if (cam.distance !== a.distance || cam.height !== a.height) {
      const first = a.distance < 0;
      a.distance = cam.distance;
      a.height = cam.height;
      const az = first ? 0 : Math.atan2(camera.position.x, camera.position.z);
      camera.position.set(Math.sin(az) * cam.distance, cam.height, Math.cos(az) * cam.distance);
      camera.lookAt(0, 0, 0);
    }
  }, -2);
  useFrame((state) => {
    const amount = liveModulation.global.cameraShake;
    if (amount <= 0.001) return;
    const t = state.clock.elapsedTime;
    const s = shake.current;
    s.x = Math.sin(t * 41.3) * Math.cos(t * 17.1) * amount * 0.35;
    s.y = Math.sin(t * 37.7 + 1.3) * amount * 0.35;
    state.camera.position.x += s.x;
    state.camera.position.y += s.y;
  });
  return null;
}

function PostFX() {
  const post = useSceneStore((s) => s.scene.post);
  const quality = useEditorStore((s) => s.quality);
  const bloomRef = useRef<BloomEffect>(null);
  useFrame(() => {
    if (bloomRef.current) bloomRef.current.intensity = post.bloom.intensity * liveModulation.global.bloomMultiplier;
  });
  if (!RENDER_QUALITY_SETTINGS[quality].postprocessing) return null;
  const ca = post.chromaticAberration * 0.004;
  return (
    <EffectComposer multisampling={quality === "high" ? 4 : 0}>
      {post.bloom.enabled ? (
        <Bloom ref={bloomRef} mipmapBlur luminanceThreshold={post.bloom.threshold} luminanceSmoothing={0.2} intensity={post.bloom.intensity} radius={post.bloom.radius} />
      ) : (
        <></>
      )}
      <ChromaticAberration offset={[ca, ca]} radialModulation={false} modulationOffset={0} />
      <Vignette darkness={post.vignette} offset={0.3} />
      <Noise opacity={post.noise * 0.35} premultiply />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
    </EffectComposer>
  );
}

const LayerNode = memo(function LayerNode({ layer, index, particleScale }: { layer: Layer; index: number; particleScale: number }) {
  const groupRef = useRef<THREE.Group>(null);
  const objRef = useRef<LayerObject<Layer> | null>(null);
  const selectLayer = useSceneStore((s) => s.selectLayer);
  const type = layer.type;
  useLayoutEffect(() => {
    const obj = createLayerObject(type);
    objRef.current = obj;
    const group = groupRef.current;
    group?.add(obj.root);
    return () => {
      group?.remove(obj.root);
      obj.dispose();
      objRef.current = null;
    };
  }, [type]);
  useLayoutEffect(() => {
    objRef.current?.setConfig(layer, { index, particleScale });
  }, [layer, index, particleScale]);
  useFrame((state, delta) => {
    const cam = state.camera as THREE.PerspectiveCamera;
    const pixelScale = (state.size.height * state.viewport.dpr) / (2 * Math.tan(((cam.fov ?? 55) * Math.PI) / 360));
    objRef.current?.update({ dt: Math.min(delta, 0.1), elapsed: state.clock.elapsedTime, camera: state.camera, pixelScale });
  });
  return (
    <group
      ref={groupRef}
      onClick={(e) => {
        if (e.delta > 4) return;
        e.stopPropagation();
        selectLayer(layer.id);
      }}
    />
  );
});

function SceneContent() {
  const layers = useSceneStore((s) => s.scene.layers);
  const autoRotate = useSceneStore((s) => s.scene.environment.camera.autoRotate);
  const autoRotateSpeed = useSceneStore((s) => s.scene.environment.camera.autoRotateSpeed);
  const quality = useEditorStore((s) => s.quality);
  const particleScale = RENDER_QUALITY_SETTINGS[quality].particleScale;
  return (
    <>
      <OrbitControls makeDefault enableDamping autoRotate={autoRotate} autoRotateSpeed={autoRotateSpeed} maxDistance={150} />
      <ModulationDriver />
      <CameraRig />
      <EnvironmentNode />
      <RendererBridge />
      {layers.map((layer, i) => (
        <LayerNode key={layer.id} layer={layer} index={i} particleScale={particleScale} />
      ))}
      <PostFX />
    </>
  );
}

const QUALITY_OPTIONS = (Object.keys(RENDER_QUALITY_SETTINGS) as RenderQuality[]).map((q) => ({ value: q, label: RENDER_QUALITY_SETTINGS[q].label }));

/** Quality selector + optional stats readout (DOM text updated ~4x/s, no React state per frame). */
function ViewportHud() {
  const quality = useEditorStore((s) => s.quality);
  const setQuality = useEditorStore((s) => s.setQuality);
  const showStats = useEditorStore((s) => s.showStats);
  const toggleStats = useEditorStore((s) => s.toggleStats);
  const statsRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!showStats) return;
    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - last < 250) return;
      last = now;
      const r = getRenderer();
      const el = statsRef.current;
      if (!r || !el) return;
      const s = r.getStats();
      el.textContent = `${s.fps.toFixed(0)} fps · ${s.frameMs.toFixed(1)} ms · ${s.drawCalls} calls · ${(s.triangles / 1000).toFixed(1)}k tris · ${(s.points / 1000).toFixed(1)}k pts · ${s.width}×${s.height} @${s.dpr.toFixed(2)}x`;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [showStats]);
  return (
    <div className="pointer-events-none absolute left-3 top-3 z-10 flex flex-col items-start gap-1.5">
      <div className="pointer-events-auto flex items-center gap-1 rounded-lg bg-surface-1/80 p-1 ring-1 ring-line backdrop-blur">
        <Select value={quality} options={QUALITY_OPTIONS} onChange={setQuality} className="h-6 text-[11px]" />
        <Button variant="ghost" size="xs" active={showStats} onClick={toggleStats} aria-pressed={showStats} title="Show renderer stats">
          Stats
        </Button>
      </div>
      {showStats ? <span ref={statsRef} className="rounded-md bg-surface-1/80 px-2 py-1 font-mono text-[10px] tabular-nums text-fg-muted ring-1 ring-line backdrop-blur" /> : null}
    </div>
  );
}

export function Viewport() {
  const quality = useEditorStore((s) => s.quality);
  const status = useEditorStore((s) => s.rendererStatus);
  const cam = useSceneStore.getState().scene.environment.camera;
  return (
    <div className="relative h-full w-full overflow-hidden bg-surface-0">
      <Canvas
        dpr={[1, RENDER_QUALITY_SETTINGS[quality].maxDpr]}
        gl={{ preserveDrawingBuffer: true, antialias: true }}
        camera={{ fov: cam.fov, position: [0, cam.height, cam.distance], near: 0.05, far: 500 }}
        onCreated={(state) => {
          state.gl.setClearColor(0x000000, 1);
          state.raycaster.params.Points.threshold = 0.25;
        }}
      >
        <SceneContent />
      </Canvas>
      <ViewportHud />
      {status === "context-lost" || status === "unsupported" || status === "error" ? (
        <div className="absolute inset-0 flex items-center justify-center bg-surface-0/80 text-sm text-fg-muted">
          {status === "context-lost" ? "WebGL context lost — waiting for the GPU to recover…" : "WebGL is unavailable in this browser."}
        </div>
      ) : null}
    </div>
  );
}

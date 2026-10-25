"use client";

/**
 * Live viewport: the single R3F <Canvas>. Runs computeModulation once per
 * frame, registers the RendererHandle and renders scene layers.
 */
import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { memo, useEffect, useLayoutEffect, useRef } from "react";
import * as THREE from "three";
import { computeModulation, liveModulation } from "@/shared/modulation/engine";
import { RENDER_QUALITY_SETTINGS, type RendererHandle, type RendererStats } from "@/shared/render/contract";
import { audioBus } from "@/shared/runtime/audioBus";
import { registerRenderer } from "@/shared/runtime/registry";
import type { Layer, ParticlesLayer } from "@/shared/scene/schema";
import { useEditorStore } from "@/store/editorStore";
import { getSceneSnapshot, useSceneStore } from "@/store/sceneStore";
import { ParticlesObject } from "./objects/ParticlesObject";

function ModulationDriver() {
  useFrame((_, delta) => {
    computeModulation(getSceneSnapshot(), audioBus.features, Math.min(delta, 0.1), liveModulation);
  }, -1);
  return null;
}

function RendererBridge() {
  const get = useThree((s) => s.get);
  const stats = useRef<RendererStats>({ fps: 0, frameMs: 0, drawCalls: 0, triangles: 0, points: 0, width: 0, height: 0, dpr: 1 });
  useFrame((state, delta) => {
    const s = stats.current;
    const ms = delta * 1000;
    s.frameMs = s.frameMs * 0.9 + ms * 0.1;
    s.fps = s.frameMs > 0 ? 1000 / s.frameMs : 0;
    s.drawCalls = state.gl.info.render.calls;
    s.triangles = state.gl.info.render.triangles;
    s.points = state.gl.info.render.points;
    s.width = state.size.width;
    s.height = state.size.height;
    s.dpr = state.viewport.dpr;
  });
  useEffect(() => {
    const { gl } = get();
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

const LayerNode = memo(function LayerNode({ layer, index, particleScale }: { layer: Layer; index: number; particleScale: number }) {
  const groupRef = useRef<THREE.Group>(null);
  const objRef = useRef<ParticlesObject | null>(null);
  const selectLayer = useSceneStore((s) => s.selectLayer);
  const isParticles = layer.type === "particles";
  useLayoutEffect(() => {
    if (!isParticles) return;
    const obj = new ParticlesObject();
    objRef.current = obj;
    const group = groupRef.current;
    group?.add(obj.root);
    return () => {
      group?.remove(obj.root);
      obj.dispose();
      objRef.current = null;
    };
  }, [isParticles]);
  useLayoutEffect(() => {
    if (layer.type === "particles") objRef.current?.setConfig(layer as ParticlesLayer, { index, particleScale });
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
  const camera = useSceneStore((s) => s.scene.environment.camera);
  const background = useSceneStore((s) => s.scene.environment.background.colorA);
  const quality = useEditorStore((s) => s.quality);
  const particleScale = RENDER_QUALITY_SETTINGS[quality].particleScale;
  return (
    <>
      <color attach="background" args={[background]} />
      <ambientLight intensity={0.4} />
      <OrbitControls makeDefault enableDamping autoRotate={camera.autoRotate} autoRotateSpeed={camera.autoRotateSpeed} />
      <ModulationDriver />
      <RendererBridge />
      {layers.map((layer, i) => (
        <LayerNode key={layer.id} layer={layer} index={i} particleScale={particleScale} />
      ))}
    </>
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
      >
        <SceneContent />
      </Canvas>
      {status === "context-lost" || status === "unsupported" || status === "error" ? (
        <div className="absolute inset-0 flex items-center justify-center bg-surface-0/80 text-sm text-fg-muted">
          {status === "context-lost" ? "WebGL context lost — waiting for the GPU to recover…" : "WebGL is unavailable in this browser."}
        </div>
      ) : null}
    </div>
  );
}

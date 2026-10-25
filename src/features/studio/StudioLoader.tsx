"use client";

/**
 * Client-only entry point (owned by the lead orchestrator). The studio uses
 * WebGL, Web Audio and browser storage, so it is never server-rendered.
 */
import dynamic from "next/dynamic";
import { useEffect } from "react";
import { installDebugHook } from "@/store/debug";
import { useStudioShortcuts } from "./useStudioShortcuts";

const Studio = dynamic(() => import("./Studio").then((m) => m.Studio), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-surface-0">
      <div className="flex flex-col items-center gap-3">
        <div className="text-[13px] font-semibold tracking-[0.42em] text-fg">VANTA</div>
        <div className="h-px w-24 overflow-hidden bg-surface-3">
          <div className="h-px w-1/2 animate-pulse bg-gradient-to-r from-violet to-cyan" />
        </div>
      </div>
    </div>
  ),
});

export function StudioLoader() {
  useEffect(() => installDebugHook(), []);
  useStudioShortcuts();
  return <Studio />;
}

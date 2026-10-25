/**
 * Editor UI state (not saved with scenes).
 * OWNERSHIP: Agent 1 (Frontend UI & 3D). Other areas may read these fields.
 */
import { create } from "zustand";
import type { RenderQuality, RendererStatus } from "@/shared/render/contract";

export type BottomPanel = "none" | "nodes";

export interface EditorState {
  quality: RenderQuality;
  /** Presentation mode: panels hidden, viewport fills the screen (uses the Fullscreen API when available). */
  presenting: boolean;
  bottomPanel: BottomPanel;
  showStats: boolean;
  rendererStatus: RendererStatus;
  rendererError: string | null;
  setQuality(quality: RenderQuality): void;
  setPresenting(presenting: boolean): void;
  setBottomPanel(panel: BottomPanel): void;
  toggleStats(): void;
  setRendererStatus(status: RendererStatus, error?: string | null): void;
}

export const useEditorStore = create<EditorState>()((set) => ({
  quality: "balanced",
  presenting: false,
  bottomPanel: "none",
  showStats: false,
  rendererStatus: "initializing",
  rendererError: null,
  setQuality: (quality) => set({ quality }),
  setPresenting: (presenting) => set({ presenting }),
  setBottomPanel: (bottomPanel) => set({ bottomPanel }),
  toggleStats: () => set((s) => ({ showStats: !s.showStats })),
  setRendererStatus: (rendererStatus, rendererError = null) => set({ rendererStatus, rendererError }),
}));

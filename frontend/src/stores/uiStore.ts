import { create } from 'zustand'

/**
 * Which top-level section the app is showing.
 *
 * Until Documentation there was no such thing: the view was implied by the
 * active design's type, because everything was a canvas. Documentation is the
 * first section that belongs to the whole homelab rather than to one design, so
 * the mode has to be state of its own.
 */
export type AppView = 'canvas' | 'documentation'

export const CANVAS_LOCK_KEY = 'homelable.canvasLocked'

/**
 * Whether the canvas starts locked (view mode). An explicit choice is
 * remembered per browser; without one, touch-first devices start locked,
 * because a pinch or a double tap there lands on nodes and edits them.
 */
export function readCanvasLocked(): boolean {
  try {
    const saved = localStorage.getItem(CANVAS_LOCK_KEY)
    if (saved === '1') return true
    if (saved === '0') return false
  } catch {
    // Storage unavailable (private mode): fall through to the device default.
  }
  if (typeof window === 'undefined') return false
  return window.matchMedia?.('(pointer: coarse)').matches ?? false
}

interface UiState {
  view: AppView
  setView: (view: AppView) => void
  /** The navigation drawer on phone-sized screens. Ignored from `md` up. */
  navOpen: boolean
  setNavOpen: (open: boolean) => void
  /**
   * View mode for the network canvas: pan, zoom and tap to inspect, but no
   * dragging, connecting, resizing, deleting or double-click editing.
   */
  canvasLocked: boolean
  setCanvasLocked: (locked: boolean) => void
}

export const useUiStore = create<UiState>()((set) => ({
  view: 'canvas',
  setView: (view) => set({ view, navOpen: false }),
  navOpen: false,
  setNavOpen: (navOpen) => set({ navOpen }),
  canvasLocked: readCanvasLocked(),
  setCanvasLocked: (canvasLocked) => {
    try { localStorage.setItem(CANVAS_LOCK_KEY, canvasLocked ? '1' : '0') } catch { /* not persisted */ }
    set({ canvasLocked })
  },
}))

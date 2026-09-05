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

interface UiState {
  view: AppView
  setView: (view: AppView) => void
}

export const useUiStore = create<UiState>()((set) => ({
  view: 'canvas',
  setView: (view) => set({ view }),
}))

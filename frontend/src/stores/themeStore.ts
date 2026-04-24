import { create } from 'zustand'
import type { ThemeId } from '@/utils/themes'
import type { CustomStyleDef } from '@/types'

interface ThemeState {
  activeTheme: ThemeId
  setTheme: (id: ThemeId) => void
  customStyle: CustomStyleDef
  setCustomStyle: (def: CustomStyleDef) => void
}

export const useThemeStore = create<ThemeState>((set) => ({
  activeTheme: 'default',
  setTheme: (id) => set({ activeTheme: id }),
  customStyle: { nodes: {}, edges: {} },
  setCustomStyle: (def) => set({ customStyle: def }),
}))

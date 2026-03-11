import { create } from 'zustand'
import type { ThemeId } from '@/utils/themes'

interface ThemeState {
  activeTheme: ThemeId
  setTheme: (id: ThemeId) => void
}

export const useThemeStore = create<ThemeState>((set) => ({
  activeTheme: 'default',
  setTheme: (id) => set({ activeTheme: id }),
}))

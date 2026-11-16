import { create } from 'zustand'
import type { ThemeId } from '@/utils/themes'
import type { CustomStyleDef } from '@/types'

/**
 * Look of the app chrome (sidebar, toolbar, dialogs, toasts) — independent of
 * the canvas style, which is saved per design. Remembered per browser.
 * - 'classic': the original always-dark Homelable look
 * - 'dark' / 'light': the flatter Home Assistant-style chrome
 * - 'system': 'dark' or 'light' from the OS colour scheme
 */
export type InterfaceTheme = 'classic' | 'dark' | 'light' | 'system'

export const INTERFACE_THEMES: readonly InterfaceTheme[] = ['classic', 'dark', 'light', 'system']
export const INTERFACE_THEME_STORAGE_KEY = 'homelable.interfaceTheme'
export const DEFAULT_INTERFACE_THEME: InterfaceTheme = 'dark'

function isInterfaceTheme(v: unknown): v is InterfaceTheme {
  return typeof v === 'string' && (INTERFACE_THEMES as readonly string[]).includes(v)
}

export function readInterfaceTheme(): InterfaceTheme {
  try {
    const v = localStorage.getItem(INTERFACE_THEME_STORAGE_KEY)
    return isInterfaceTheme(v) ? v : DEFAULT_INTERFACE_THEME
  } catch {
    return DEFAULT_INTERFACE_THEME
  }
}

function readSystemDark(): boolean {
  try {
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true
  } catch {
    return true
  }
}

interface ThemeState {
  activeTheme: ThemeId
  setTheme: (id: ThemeId) => void
  customStyle: CustomStyleDef
  setCustomStyle: (def: CustomStyleDef) => void
  interfaceTheme: InterfaceTheme
  setInterfaceTheme: (mode: InterfaceTheme) => void
  /** Mirrors `prefers-color-scheme: dark`; only read by the 'system' interface. */
  systemDark: boolean
  setSystemDark: (dark: boolean) => void
}

export const useThemeStore = create<ThemeState>((set) => ({
  activeTheme: 'default',
  setTheme: (id) => set({ activeTheme: id }),
  customStyle: { nodes: {}, edges: {} },
  setCustomStyle: (def) => set({ customStyle: def }),
  interfaceTheme: readInterfaceTheme(),
  setInterfaceTheme: (mode) => {
    try {
      localStorage.setItem(INTERFACE_THEME_STORAGE_KEY, mode)
    } catch {
      // Storage blocked: the choice still applies for this session.
    }
    set({ interfaceTheme: mode })
  },
  systemDark: readSystemDark(),
  setSystemDark: (dark) => set((s) => (s.systemDark === dark ? s : { systemDark: dark })),
}))

/** The interface actually drawn: 'system' resolved against the OS scheme. */
export function resolveInterfaceTheme(mode: InterfaceTheme, systemDark: boolean): Exclude<InterfaceTheme, 'system'> {
  if (mode === 'system') return systemDark ? 'dark' : 'light'
  return mode
}

/** True when the app chrome is rendered light. */
export const selectInterfaceIsLight = (s: ThemeState) =>
  resolveInterfaceTheme(s.interfaceTheme, s.systemDark) === 'light'

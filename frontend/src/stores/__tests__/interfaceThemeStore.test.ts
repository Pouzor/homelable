import { describe, it, expect, beforeEach } from 'vitest'
import {
  DEFAULT_INTERFACE_THEME,
  INTERFACE_THEME_STORAGE_KEY,
  readInterfaceTheme,
  resolveInterfaceTheme,
  selectInterfaceIsLight,
  useThemeStore,
} from '@/stores/themeStore'

describe('themeStore — interface theme', () => {
  beforeEach(() => {
    localStorage.clear()
    useThemeStore.setState({ interfaceTheme: DEFAULT_INTERFACE_THEME, systemDark: true })
  })

  it('defaults to the Dark interface when nothing is stored', () => {
    expect(readInterfaceTheme()).toBe('dark')
  })

  it('reads a stored choice and ignores junk', () => {
    localStorage.setItem(INTERFACE_THEME_STORAGE_KEY, 'classic')
    expect(readInterfaceTheme()).toBe('classic')
    localStorage.setItem(INTERFACE_THEME_STORAGE_KEY, 'neon')
    expect(readInterfaceTheme()).toBe(DEFAULT_INTERFACE_THEME)
  })

  it('setInterfaceTheme updates the store and remembers the choice', () => {
    useThemeStore.getState().setInterfaceTheme('light')
    expect(useThemeStore.getState().interfaceTheme).toBe('light')
    expect(localStorage.getItem(INTERFACE_THEME_STORAGE_KEY)).toBe('light')
  })

  it('setSystemDark keeps the state object when nothing changes', () => {
    const before = useThemeStore.getState()
    useThemeStore.getState().setSystemDark(true)
    expect(useThemeStore.getState()).toBe(before)
    useThemeStore.getState().setSystemDark(false)
    expect(useThemeStore.getState().systemDark).toBe(false)
  })

  it('resolves system against the OS scheme and leaves the rest alone', () => {
    expect(resolveInterfaceTheme('system', true)).toBe('dark')
    expect(resolveInterfaceTheme('system', false)).toBe('light')
    expect(resolveInterfaceTheme('classic', false)).toBe('classic')
    expect(resolveInterfaceTheme('light', true)).toBe('light')
  })

  it('selectInterfaceIsLight is true only for a light chrome', () => {
    const state = useThemeStore.getState()
    expect(selectInterfaceIsLight({ ...state, interfaceTheme: 'light' })).toBe(true)
    expect(selectInterfaceIsLight({ ...state, interfaceTheme: 'system', systemDark: false })).toBe(true)
    expect(selectInterfaceIsLight({ ...state, interfaceTheme: 'system', systemDark: true })).toBe(false)
    expect(selectInterfaceIsLight({ ...state, interfaceTheme: 'classic', systemDark: false })).toBe(false)
  })
})

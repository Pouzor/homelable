import { describe, it, expect, beforeEach } from 'vitest'
import { useThemeStore } from '@/stores/themeStore'

describe('themeStore', () => {
  beforeEach(() => {
    useThemeStore.setState({ activeTheme: 'default' })
  })

  it('starts with default theme', () => {
    expect(useThemeStore.getState().activeTheme).toBe('default')
  })

  it('setTheme updates activeTheme', () => {
    useThemeStore.getState().setTheme('matrix')
    expect(useThemeStore.getState().activeTheme).toBe('matrix')
  })

  it('setTheme can switch between all presets', () => {
    const themes = ['default', 'dark', 'light', 'neon', 'matrix'] as const
    for (const id of themes) {
      useThemeStore.getState().setTheme(id)
      expect(useThemeStore.getState().activeTheme).toBe(id)
    }
  })

  it('setTheme back to default after neon', () => {
    useThemeStore.getState().setTheme('neon')
    useThemeStore.getState().setTheme('default')
    expect(useThemeStore.getState().activeTheme).toBe('default')
  })
})

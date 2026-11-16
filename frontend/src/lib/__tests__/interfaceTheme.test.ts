import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { applyInterfaceTheme, installInterfaceTheme, LIGHT_CLASS, MODERN_CLASS } from '@/lib/interfaceTheme'
import { useThemeStore } from '@/stores/themeStore'

describe('applyInterfaceTheme', () => {
  it('Classic sets no class, so the :root tokens apply', () => {
    const el = document.createElement('div')
    el.classList.add(MODERN_CLASS, LIGHT_CLASS)
    applyInterfaceTheme(el, 'classic', false)
    expect(el.className).toBe('')
  })

  it('Dark sets the modern class only', () => {
    const el = document.createElement('div')
    applyInterfaceTheme(el, 'dark', false)
    expect(el.classList.contains(MODERN_CLASS)).toBe(true)
    expect(el.classList.contains(LIGHT_CLASS)).toBe(false)
  })

  it('Light sets both classes', () => {
    const el = document.createElement('div')
    applyInterfaceTheme(el, 'light', true)
    expect(el.classList.contains(MODERN_CLASS)).toBe(true)
    expect(el.classList.contains(LIGHT_CLASS)).toBe(true)
  })

  it('System follows the OS scheme', () => {
    const el = document.createElement('div')
    applyInterfaceTheme(el, 'system', false)
    expect(el.classList.contains(LIGHT_CLASS)).toBe(true)
    applyInterfaceTheme(el, 'system', true)
    expect(el.classList.contains(LIGHT_CLASS)).toBe(false)
    expect(el.classList.contains(MODERN_CLASS)).toBe(true)
  })
})

describe('installInterfaceTheme', () => {
  let listeners: ((e: { matches: boolean }) => void)[]
  let uninstall: (() => void) | undefined

  beforeEach(() => {
    listeners = []
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: true,
      addEventListener: (_: string, cb: (e: { matches: boolean }) => void) => listeners.push(cb),
      removeEventListener: (_: string, cb: (e: { matches: boolean }) => void) => {
        listeners = listeners.filter((l) => l !== cb)
      },
    })))
    useThemeStore.setState({ interfaceTheme: 'dark', systemDark: true })
  })

  afterEach(() => {
    uninstall?.()
    vi.unstubAllGlobals()
  })

  it('applies at once and follows later store changes', () => {
    const el = document.createElement('div')
    uninstall = installInterfaceTheme(el)
    expect(el.classList.contains(MODERN_CLASS)).toBe(true)

    useThemeStore.getState().setInterfaceTheme('classic')
    expect(el.classList.contains(MODERN_CLASS)).toBe(false)
  })

  it('tracks the OS scheme for the system interface', () => {
    const el = document.createElement('div')
    useThemeStore.setState({ interfaceTheme: 'system' })
    uninstall = installInterfaceTheme(el)
    expect(el.classList.contains(LIGHT_CLASS)).toBe(false)

    listeners.forEach((l) => l({ matches: false }))
    expect(el.classList.contains(LIGHT_CLASS)).toBe(true)
  })

  it('stops listening once uninstalled', () => {
    const el = document.createElement('div')
    installInterfaceTheme(el)()
    expect(listeners).toHaveLength(0)
    useThemeStore.getState().setInterfaceTheme('light')
    expect(el.classList.contains(LIGHT_CLASS)).toBe(false)
  })
})

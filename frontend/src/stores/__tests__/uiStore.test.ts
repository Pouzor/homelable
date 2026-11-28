import { describe, it, expect, afterEach, vi } from 'vitest'
import { CANVAS_LOCK_KEY, readCanvasLocked, useUiStore } from '../uiStore'

function mockPointer(coarse: boolean) {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: q === '(pointer: coarse)' ? coarse : false,
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
}

describe('uiStore canvas lock', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    useUiStore.setState({ canvasLocked: false, navOpen: false, view: 'canvas' })
  })

  it('starts locked on a touch-first device', () => {
    mockPointer(true)
    expect(readCanvasLocked()).toBe(true)
  })

  it('starts unlocked with a mouse', () => {
    mockPointer(false)
    expect(readCanvasLocked()).toBe(false)
  })

  it('starts unlocked when matchMedia is unavailable', () => {
    vi.stubGlobal('matchMedia', undefined)
    expect(readCanvasLocked()).toBe(false)
  })

  it('a remembered choice beats the device default', () => {
    mockPointer(true)
    localStorage.setItem(CANVAS_LOCK_KEY, '0')
    expect(readCanvasLocked()).toBe(false)
    mockPointer(false)
    localStorage.setItem(CANVAS_LOCK_KEY, '1')
    expect(readCanvasLocked()).toBe(true)
  })

  it('setCanvasLocked updates the store and remembers the choice', () => {
    useUiStore.getState().setCanvasLocked(true)
    expect(useUiStore.getState().canvasLocked).toBe(true)
    expect(localStorage.getItem(CANVAS_LOCK_KEY)).toBe('1')
    useUiStore.getState().setCanvasLocked(false)
    expect(localStorage.getItem(CANVAS_LOCK_KEY)).toBe('0')
  })
})

describe('uiStore navigation drawer', () => {
  it('switching view closes the drawer', () => {
    useUiStore.setState({ navOpen: true })
    useUiStore.getState().setView('documentation')
    expect(useUiStore.getState().navOpen).toBe(false)
    expect(useUiStore.getState().view).toBe('documentation')
    useUiStore.getState().setView('canvas')
  })
})

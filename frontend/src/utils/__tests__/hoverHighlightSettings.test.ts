import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  DEFAULT_HOVER_HIGHLIGHT_SETTINGS,
  readHoverHighlightSettings,
  writeHoverHighlightSettings,
  subscribeHoverHighlightSettings,
} from '../hoverHighlightSettings'

describe('hoverHighlightSettings', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('is on by default when nothing is stored', () => {
    expect(readHoverHighlightSettings()).toEqual({ enabled: true })
    expect(DEFAULT_HOVER_HIGHLIGHT_SETTINGS.enabled).toBe(true)
  })

  it('roundtrips through localStorage', () => {
    writeHoverHighlightSettings({ enabled: false })
    expect(readHoverHighlightSettings()).toEqual({ enabled: false })
  })

  it('falls back to defaults when stored value is corrupted', () => {
    localStorage.setItem('homelable.hoverHighlight', '{not json')
    expect(readHoverHighlightSettings()).toEqual(DEFAULT_HOVER_HIGHLIGHT_SETTINGS)
  })

  it('ignores a non-boolean enabled flag', () => {
    localStorage.setItem('homelable.hoverHighlight', JSON.stringify({ enabled: 'no' }))
    expect(readHoverHighlightSettings()).toEqual(DEFAULT_HOVER_HIGHLIGHT_SETTINGS)
  })

  it('notifies subscribers on write', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeHoverHighlightSettings(listener)
    writeHoverHighlightSettings({ enabled: false })
    expect(listener).toHaveBeenCalledWith({ enabled: false })
    unsubscribe()
    writeHoverHighlightSettings({ enabled: true })
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

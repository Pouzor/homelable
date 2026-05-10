import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  DEFAULT_ALIGNMENT_SETTINGS,
  readAlignmentSettings,
  writeAlignmentSettings,
  subscribeAlignmentSettings,
} from '../alignmentSettings'

describe('alignmentSettings', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns defaults when nothing stored', () => {
    expect(readAlignmentSettings()).toEqual(DEFAULT_ALIGNMENT_SETTINGS)
  })

  it('roundtrips through localStorage', () => {
    writeAlignmentSettings({ enabled: false, threshold: 10 })
    expect(readAlignmentSettings()).toEqual({ enabled: false, threshold: 10 })
  })

  it('falls back to defaults when stored value is corrupted', () => {
    localStorage.setItem('homelable.alignmentGuides', '{not json')
    expect(readAlignmentSettings()).toEqual(DEFAULT_ALIGNMENT_SETTINGS)
  })

  it('fills missing fields from defaults', () => {
    localStorage.setItem('homelable.alignmentGuides', JSON.stringify({ enabled: false }))
    expect(readAlignmentSettings()).toEqual({ enabled: false, threshold: DEFAULT_ALIGNMENT_SETTINGS.threshold })
  })

  it('notifies subscribers on write', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeAlignmentSettings(listener)
    writeAlignmentSettings({ enabled: false, threshold: 8 })
    expect(listener).toHaveBeenCalledWith({ enabled: false, threshold: 8 })
    unsubscribe()
    writeAlignmentSettings({ enabled: true, threshold: 4 })
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

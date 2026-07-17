import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  DEFAULT_AUTOSAVE_SETTINGS,
  readAutosaveSettings,
  writeAutosaveSettings,
  subscribeAutosaveSettings,
} from '../autosaveSettings'

describe('autosaveSettings', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('defaults to disabled with a 5s delay', () => {
    expect(DEFAULT_AUTOSAVE_SETTINGS).toEqual({ enabled: false, delay: 5 })
  })

  it('returns defaults when nothing stored', () => {
    expect(readAutosaveSettings()).toEqual(DEFAULT_AUTOSAVE_SETTINGS)
  })

  it('roundtrips through localStorage', () => {
    writeAutosaveSettings({ enabled: true, delay: 30 })
    expect(readAutosaveSettings()).toEqual({ enabled: true, delay: 30 })
  })

  it('falls back to defaults when stored value is corrupted', () => {
    localStorage.setItem('homelable.autosave', '{not json')
    expect(readAutosaveSettings()).toEqual(DEFAULT_AUTOSAVE_SETTINGS)
  })

  it('fills missing fields from defaults', () => {
    localStorage.setItem('homelable.autosave', JSON.stringify({ enabled: true }))
    expect(readAutosaveSettings()).toEqual({ enabled: true, delay: DEFAULT_AUTOSAVE_SETTINGS.delay })
  })

  it('rejects a non-positive delay and falls back to default', () => {
    localStorage.setItem('homelable.autosave', JSON.stringify({ enabled: true, delay: 0 }))
    expect(readAutosaveSettings().delay).toBe(DEFAULT_AUTOSAVE_SETTINGS.delay)
    localStorage.setItem('homelable.autosave', JSON.stringify({ enabled: true, delay: -10 }))
    expect(readAutosaveSettings().delay).toBe(DEFAULT_AUTOSAVE_SETTINGS.delay)
  })

  it('rejects a non-numeric delay and falls back to default', () => {
    localStorage.setItem('homelable.autosave', JSON.stringify({ enabled: true, delay: 'soon' }))
    expect(readAutosaveSettings().delay).toBe(DEFAULT_AUTOSAVE_SETTINGS.delay)
  })

  it('rejects a non-boolean enabled and falls back to default', () => {
    localStorage.setItem('homelable.autosave', JSON.stringify({ enabled: 'yes', delay: 10 }))
    expect(readAutosaveSettings().enabled).toBe(DEFAULT_AUTOSAVE_SETTINGS.enabled)
  })

  it('notifies subscribers on write and stops after unsubscribe', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeAutosaveSettings(listener)
    writeAutosaveSettings({ enabled: true, delay: 10 })
    expect(listener).toHaveBeenCalledWith({ enabled: true, delay: 10 })
    unsubscribe()
    writeAutosaveSettings({ enabled: false, delay: 3 })
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

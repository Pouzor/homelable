import { describe, it, expect, beforeEach } from 'vitest'
import { getDesignIdFromUrl, setDesignIdInUrl } from '@/utils/designUrl'

describe('designUrl', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/')
  })

  it('returns null when no design param is present', () => {
    expect(getDesignIdFromUrl()).toBeNull()
  })

  it('reads the design id from the URL', () => {
    window.history.replaceState(null, '', '/?design=abc-123')
    expect(getDesignIdFromUrl()).toBe('abc-123')
  })

  it('writes the design id into the URL without adding history', () => {
    const before = window.history.length
    setDesignIdInUrl('design-42')
    expect(getDesignIdFromUrl()).toBe('design-42')
    expect(window.history.length).toBe(before)
  })

  it('drops the param when passed null', () => {
    setDesignIdInUrl('design-42')
    setDesignIdInUrl(null)
    expect(getDesignIdFromUrl()).toBeNull()
    expect(window.location.search).toBe('')
  })

  it('preserves other query params when updating design', () => {
    window.history.replaceState(null, '', '/?key=secret')
    setDesignIdInUrl('design-42')
    const params = new URLSearchParams(window.location.search)
    expect(params.get('key')).toBe('secret')
    expect(params.get('design')).toBe('design-42')
  })

  it('round-trips: written id is read back', () => {
    setDesignIdInUrl('xyz')
    expect(getDesignIdFromUrl()).toBe('xyz')
  })
})

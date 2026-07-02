import { describe, it, expect } from 'vitest'
import { formatTimestamp, formatRelative } from '../timeFormat'

describe('formatTimestamp', () => {
  it('parses an ISO string with a Z suffix', () => {
    expect(formatTimestamp('2026-01-02T10:00:00Z')).toContain('2026')
  })

  it('treats a suffix-less timestamp as UTC (appends Z)', () => {
    // Same instant expressed with and without the explicit Z must match.
    expect(formatTimestamp('2026-01-02 10:00:00')).toBe(formatTimestamp('2026-01-02T10:00:00Z'))
  })
})

describe('formatRelative', () => {
  const now = Date.parse('2026-06-27T12:00:00Z')

  it('returns "just now" for sub-minute deltas', () => {
    expect(formatRelative('2026-06-27T11:59:30Z', now)).toBe('just now')
  })

  it('formats minutes', () => {
    expect(formatRelative('2026-06-27T11:45:00Z', now)).toBe('15m ago')
  })

  it('formats hours', () => {
    expect(formatRelative('2026-06-27T09:00:00Z', now)).toBe('3h ago')
  })

  it('formats days', () => {
    expect(formatRelative('2026-06-25T12:00:00Z', now)).toBe('2d ago')
  })

  it('formats weeks', () => {
    expect(formatRelative('2026-06-06T12:00:00Z', now)).toBe('3w ago')
  })

  it('formats months', () => {
    expect(formatRelative('2026-02-27T12:00:00Z', now)).toBe('4mo ago')
  })

  it('formats years', () => {
    expect(formatRelative('2024-06-27T12:00:00Z', now)).toBe('2y ago')
  })

  it('clamps future timestamps to "just now"', () => {
    expect(formatRelative('2026-06-27T12:05:00Z', now)).toBe('just now')
  })

  it('handles suffix-less (naive UTC) input', () => {
    expect(formatRelative('2026-06-27 11:45:00', now)).toBe('15m ago')
  })
})

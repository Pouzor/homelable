import { describe, it, expect } from 'vitest'
import { DESIGN_ICONS, DEFAULT_DESIGN_ICON, resolveDesignIcon } from '@/utils/designIcons'

describe('designIcons', () => {
  it('exposes a non-empty, unique-keyed icon set', () => {
    expect(DESIGN_ICONS.length).toBeGreaterThan(0)
    const keys = DESIGN_ICONS.map((e) => e.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('default icon key is part of the set', () => {
    expect(DESIGN_ICONS.some((e) => e.key === DEFAULT_DESIGN_ICON)).toBe(true)
  })

  it('resolveDesignIcon returns the matching component for a known key', () => {
    const entry = DESIGN_ICONS.find((e) => e.key === 'zap')!
    expect(resolveDesignIcon('zap')).toBe(entry.icon)
  })

  it('resolveDesignIcon falls back to a component for unknown/empty keys', () => {
    const fallback = resolveDesignIcon(undefined)
    expect(typeof fallback).toBe('object')
    expect(resolveDesignIcon('does-not-exist')).toBe(fallback)
    expect(resolveDesignIcon(null)).toBe(fallback)
    expect(resolveDesignIcon('')).toBe(fallback)
  })
})

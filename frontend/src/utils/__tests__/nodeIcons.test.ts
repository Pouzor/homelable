import { describe, it, expect } from 'vitest'
import { Globe } from 'lucide-react'
import { ICON_REGISTRY, ICON_CATEGORIES, ICON_MAP, resolveNodeIcon } from '../nodeIcons'

describe('ICON_REGISTRY', () => {
  it('has entries', () => {
    expect(ICON_REGISTRY.length).toBeGreaterThan(0)
  })

  it('every entry has required fields', () => {
    for (const entry of ICON_REGISTRY) {
      expect(typeof entry.key).toBe('string')
      expect(entry.key.length).toBeGreaterThan(0)
      expect(typeof entry.label).toBe('string')
      expect(typeof entry.category).toBe('string')
      expect(entry.icon).toBeTruthy()
    }
  })

  it('all keys are unique', () => {
    const keys = ICON_REGISTRY.map((e) => e.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('contains expected well-known icons', () => {
    const keys = ICON_REGISTRY.map((e) => e.key)
    expect(keys).toContain('home')      // Home Assistant
    expect(keys).toContain('play')      // Jellyfin
    expect(keys).toContain('shield')    // Pi-hole
    expect(keys).toContain('anchor')    // Portainer
    expect(keys).toContain('package')   // Docker Host
    expect(keys).toContain('key')       // Vaultwarden
    expect(keys).toContain('database')  // DB services
    expect(keys).toContain('cctv')      // IP Camera / CCTV
  })

  it('contains Smart Home / Sensors icons', () => {
    const keys = ICON_REGISTRY.map((e) => e.key)
    expect(keys).toContain('plug')
    expect(keys).toContain('smoke')
    expect(keys).toContain('door')
    expect(keys).toContain('motion')
    expect(keys).toContain('leak')
    expect(keys).toContain('lock-smart')
    expect(keys).toContain('battery-charging')
  })

  it('exposes the Smart Home / Sensors category', () => {
    const categories = ICON_REGISTRY.map((e) => e.category)
    expect(categories).toContain('Smart Home / Sensors')
  })
})

describe('ICON_CATEGORIES', () => {
  it('has at least one category', () => {
    expect(ICON_CATEGORIES.length).toBeGreaterThan(0)
  })

  it('every entry in ICON_REGISTRY belongs to a known category', () => {
    for (const entry of ICON_REGISTRY) {
      expect(ICON_CATEGORIES).toContain(entry.category)
    }
  })
})

describe('ICON_MAP', () => {
  it('contains an entry for every registry key', () => {
    for (const entry of ICON_REGISTRY) {
      expect(ICON_MAP[entry.key]).toBeDefined()
      expect(ICON_MAP[entry.key]).toBe(entry.icon)
    }
  })

  it('returns undefined for unknown keys', () => {
    expect(ICON_MAP['__nonexistent__']).toBeUndefined()
  })
})

describe('resolveNodeIcon', () => {
  it('returns typeIcon when no custom_icon set', () => {
    expect(resolveNodeIcon(Globe)).toBe(Globe)
  })

  it('returns typeIcon when custom_icon is undefined', () => {
    expect(resolveNodeIcon(Globe, undefined)).toBe(Globe)
  })

  it('returns typeIcon when custom_icon key is unknown', () => {
    expect(resolveNodeIcon(Globe, '__nonexistent__')).toBe(Globe)
  })

  it('returns the custom icon when key is valid', () => {
    const homeEntry = ICON_REGISTRY.find((e) => e.key === 'home')!
    expect(resolveNodeIcon(Globe, 'home')).toBe(homeEntry.icon)
  })

  it('custom icon overrides typeIcon', () => {
    const playEntry = ICON_REGISTRY.find((e) => e.key === 'play')!
    const result = resolveNodeIcon(Globe, 'play')
    expect(result).toBe(playEntry.icon)
    expect(result).not.toBe(Globe)
  })
})

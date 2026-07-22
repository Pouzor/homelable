import { describe, it, expect } from 'vitest'
import { Globe } from 'lucide-react'
import {
  ICON_REGISTRY, ICON_CATEGORIES, ICON_MAP, resolveNodeIcon,
  isMdiIconKey, parseMdiKey, mdiIconUrl,
  isSimpleIconKey, parseSimpleIconKey, simpleIconUrl,
  isSelfhstIconKey, parseSelfhstKey, selfhstIconUrl,
  isRemoteUrl, isLocalIcon,
  resolveCustomIcon,
} from '../nodeIcons'

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

  it('returns typeIcon for mdi: prefixed keys (not lucide)', () => {
    expect(resolveNodeIcon(Globe, 'mdi:home-assistant')).toBe(Globe)
  })

  it('returns typeIcon for si: prefixed keys (not lucide)', () => {
    expect(resolveNodeIcon(Globe, 'si:github')).toBe(Globe)
  })

  it('returns typeIcon for sh: prefixed keys (not lucide)', () => {
    expect(resolveNodeIcon(Globe, 'sh:plex')).toBe(Globe)
  })

  it('returns typeIcon for https:// remote URLs', () => {
    expect(resolveNodeIcon(Globe, 'https://example.com/icon.png')).toBe(Globe)
  })
})

describe('MDI icon helpers', () => {
  it('isMdiIconKey detects mdi: prefix', () => {
    expect(isMdiIconKey('mdi:home-assistant')).toBe(true)
    expect(isMdiIconKey('mdi:server')).toBe(true)
    expect(isMdiIconKey('brand:plex')).toBe(false)
    expect(isMdiIconKey(undefined)).toBe(false)
    expect(isMdiIconKey(null)).toBe(false)
    expect(isMdiIconKey('')).toBe(false)
  })

  it('parseMdiKey extracts name without color', () => {
    expect(parseMdiKey('mdi:home-assistant')).toEqual({ name: 'home-assistant' })
    expect(parseMdiKey('mdi:server')).toEqual({ name: 'server' })
  })

  it('parseMdiKey extracts name and color', () => {
    expect(parseMdiKey('mdi:home-assistant:#ff0000')).toEqual({ name: 'home-assistant', color: '#ff0000' })
    expect(parseMdiKey('mdi:server:#abc')).toEqual({ name: 'server', color: '#abc' })
    expect(parseMdiKey('mdi:server:#aabbcc')).toEqual({ name: 'server', color: '#aabbcc' })
  })

  it('parseMdiKey ignores invalid color suffix', () => {
    expect(parseMdiKey('mdi:server:#xyz')).toEqual({ name: 'server:#xyz' })
  })

  it('mdiIconUrl builds the jsDelivr CDN URL', () => {
    expect(mdiIconUrl('home-assistant')).toContain('home-assistant.svg')
    expect(mdiIconUrl('home-assistant')).toContain('mdi')
  })
})

describe('Simple Icons helpers', () => {
  it('isSimpleIconKey detects si: prefix', () => {
    expect(isSimpleIconKey('si:github')).toBe(true)
    expect(isSimpleIconKey('brand:github')).toBe(false)
    expect(isSimpleIconKey(undefined)).toBe(false)
  })

  it('parseSimpleIconKey extracts name without color', () => {
    expect(parseSimpleIconKey('si:github')).toEqual({ name: 'github' })
  })

  it('parseSimpleIconKey extracts name and color', () => {
    expect(parseSimpleIconKey('si:github:#1da462')).toEqual({ name: 'github', color: '#1da462' })
  })

  it('simpleIconUrl builds the jsDelivr CDN URL', () => {
    expect(simpleIconUrl('github')).toContain('github.svg')
    expect(simpleIconUrl('github')).toContain('simple-icons')
  })
})

describe('selfh.st icon helpers', () => {
  it('isSelfhstIconKey detects sh: prefix', () => {
    expect(isSelfhstIconKey('sh:plex')).toBe(true)
    expect(isSelfhstIconKey('sh:plex.svg')).toBe(true)
    expect(isSelfhstIconKey('brand:plex')).toBe(false)
    expect(isSelfhstIconKey(undefined)).toBe(false)
  })

  it('parseSelfhstKey defaults to png extension', () => {
    expect(parseSelfhstKey('sh:plex')).toEqual({ name: 'plex', ext: 'png' })
  })

  it('parseSelfhstKey detects svg and webp extensions', () => {
    expect(parseSelfhstKey('sh:plex.svg')).toEqual({ name: 'plex', ext: 'svg' })
    expect(parseSelfhstKey('sh:plex.webp')).toEqual({ name: 'plex', ext: 'webp' })
    expect(parseSelfhstKey('sh:plex.png')).toEqual({ name: 'plex', ext: 'png' })
  })

  it('selfhstIconUrl builds CDN URL with correct folder and extension', () => {
    expect(selfhstIconUrl('plex', 'png')).toContain('/png/plex.png')
    expect(selfhstIconUrl('plex', 'svg')).toContain('/svg/plex.svg')
    expect(selfhstIconUrl('plex')).toContain('/png/plex.png')
  })
})

describe('Remote and local icon helpers', () => {
  it('isRemoteUrl detects https and http', () => {
    expect(isRemoteUrl('https://example.com/icon.png')).toBe(true)
    expect(isRemoteUrl('http://example.com/icon.png')).toBe(true)
    expect(isRemoteUrl('/icons/foo.png')).toBe(false)
    expect(isRemoteUrl(undefined)).toBe(false)
  })

  it('isLocalIcon detects /icons/ prefix', () => {
    expect(isLocalIcon('/icons/myapp.png')).toBe(true)
    expect(isLocalIcon('/icons/foo.svg')).toBe(true)
    expect(isLocalIcon('https://foo.com/x.png')).toBe(false)
    expect(isLocalIcon(undefined)).toBe(false)
  })
})

describe('resolveCustomIcon extended types', () => {
  it('resolves mdi: key', () => {
    const r = resolveCustomIcon('mdi:home-assistant')
    expect(r?.kind).toBe('mdi')
    if (r?.kind === 'mdi') {
      expect(r.name).toBe('home-assistant')
      expect(r.color).toBeUndefined()
      expect(r.url).toContain('home-assistant.svg')
    }
  })

  it('resolves mdi: key with color', () => {
    const r = resolveCustomIcon('mdi:server:#ff0000')
    expect(r?.kind).toBe('mdi')
    if (r?.kind === 'mdi') {
      expect(r.name).toBe('server')
      expect(r.color).toBe('#ff0000')
    }
  })

  it('resolves si: key', () => {
    const r = resolveCustomIcon('si:github')
    expect(r?.kind).toBe('si')
    if (r?.kind === 'si') {
      expect(r.name).toBe('github')
      expect(r.url).toContain('github.svg')
    }
  })

  it('resolves sh: key', () => {
    const r = resolveCustomIcon('sh:plex')
    expect(r?.kind).toBe('sh')
    if (r?.kind === 'sh') {
      expect(r.name).toBe('plex')
      expect(r.url).toContain('/png/plex.png')
    }
  })

  it('resolves sh:.svg key', () => {
    const r = resolveCustomIcon('sh:plex.svg')
    expect(r?.kind).toBe('sh')
    if (r?.kind === 'sh') {
      expect(r.url).toContain('/svg/plex.svg')
    }
  })

  it('resolves remote URL', () => {
    const r = resolveCustomIcon('https://example.com/icon.png')
    expect(r?.kind).toBe('url')
    if (r?.kind === 'url') {
      expect(r.url).toBe('https://example.com/icon.png')
    }
  })

  it('resolves local icon path', () => {
    const r = resolveCustomIcon('/icons/myapp.png')
    expect(r?.kind).toBe('url')
    if (r?.kind === 'url') {
      expect(r.url).toBe('/icons/myapp.png')
    }
  })
})

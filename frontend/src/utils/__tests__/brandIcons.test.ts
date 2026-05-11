import { describe, it, expect } from 'vitest'
import {
  BRAND_ICON_PREFIX,
  isBrandIconKey,
  brandIconSlug,
  brandIconUrl,
  resolveCustomIcon,
  ICON_MAP,
} from '../nodeIcons'

describe('brand icon helpers', () => {
  it('isBrandIconKey returns true only for prefixed keys', () => {
    expect(isBrandIconKey('brand:plex')).toBe(true)
    expect(isBrandIconKey('plex')).toBe(false)
    expect(isBrandIconKey('plug')).toBe(false)
    expect(isBrandIconKey(undefined)).toBe(false)
    expect(isBrandIconKey(null)).toBe(false)
    expect(isBrandIconKey('')).toBe(false)
  })

  it('brandIconSlug strips the prefix', () => {
    expect(brandIconSlug(`${BRAND_ICON_PREFIX}home-assistant`)).toBe('home-assistant')
  })

  it('brandIconUrl points at jsDelivr CDN', () => {
    expect(brandIconUrl('plex')).toBe(
      'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/plex.svg',
    )
  })
})

describe('resolveCustomIcon', () => {
  it('returns null when no key', () => {
    expect(resolveCustomIcon(undefined)).toBeNull()
    expect(resolveCustomIcon('')).toBeNull()
  })

  it('resolves legacy lucide keys', () => {
    const r = resolveCustomIcon('plug')
    expect(r?.kind).toBe('lucide')
    if (r?.kind === 'lucide') expect(r.icon).toBe(ICON_MAP['plug'])
  })

  it('resolves brand-prefixed keys to a CDN url', () => {
    const r = resolveCustomIcon('brand:plex')
    expect(r?.kind).toBe('brand')
    if (r?.kind === 'brand') {
      expect(r.slug).toBe('plex')
      expect(r.url).toContain('cdn.jsdelivr.net')
      expect(r.url).toContain('/plex.svg')
    }
  })

  it('returns null for unknown legacy key', () => {
    expect(resolveCustomIcon('definitely-not-a-known-icon-key')).toBeNull()
  })
})

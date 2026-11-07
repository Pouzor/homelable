import { describe, it, expect } from 'vitest'
import { Server } from 'lucide-react'
import {
  URL_ICON_PREFIX,
  isValidIconUrl,
  isUrlIconKey,
  urlIconKey,
  urlIconSrc,
  urlIconLabel,
  isImageIconKey,
  resolveCustomIcon,
  resolveNodeIcon,
} from '../nodeIcons'

const SELFHST = 'https://cdn.jsdelivr.net/gh/selfhst/icons/svg/immich.svg'
const MEDIA = '/api/v1/media/0123456789abcdef0123456789abcdef.png'

describe('isValidIconUrl', () => {
  it('accepts absolute http(s) links', () => {
    expect(isValidIconUrl(SELFHST)).toBe(true)
    expect(isValidIconUrl('http://192.168.1.10/icons/nas.png')).toBe(true)
    expect(isValidIconUrl('  https://example.com/a.svg  ')).toBe(true)
  })

  it('accepts uploaded media paths only in their exact shape', () => {
    expect(isValidIconUrl(MEDIA)).toBe(true)
    expect(isValidIconUrl('/api/v1/media/0123456789abcdef0123456789abcdef.svg')).toBe(true)
    expect(isValidIconUrl('/api/v1/media/0123456789abcdef0123456789abcdef.pdf')).toBe(false)
    expect(isValidIconUrl('/api/v1/media/../secret.png')).toBe(false)
  })

  it('rejects script, data, protocol-relative, relative and empty links', () => {
    expect(isValidIconUrl('javascript:alert(1)')).toBe(false)
    expect(isValidIconUrl('data:image/svg+xml;base64,PHN2Zz4=')).toBe(false)
    expect(isValidIconUrl('//evil.example/a.png')).toBe(false)
    expect(isValidIconUrl('icons/a.png')).toBe(false)
    expect(isValidIconUrl('ftp://host/a.png')).toBe(false)
    expect(isValidIconUrl('https://')).toBe(false)
    expect(isValidIconUrl('')).toBe(false)
    expect(isValidIconUrl('   ')).toBe(false)
  })

  it('rejects absurdly long links', () => {
    expect(isValidIconUrl(`https://example.com/${'a'.repeat(2100)}.png`)).toBe(false)
  })
})

describe('url icon keys', () => {
  it('urlIconKey prefixes a trimmed valid link and refuses an invalid one', () => {
    expect(urlIconKey(` ${SELFHST} `)).toBe(`${URL_ICON_PREFIX}${SELFHST}`)
    expect(urlIconKey('javascript:alert(1)')).toBeNull()
  })

  it('isUrlIconKey only matches the prefix', () => {
    expect(isUrlIconKey(`url:${SELFHST}`)).toBe(true)
    expect(isUrlIconKey('brand:plex')).toBe(false)
    expect(isUrlIconKey('database')).toBe(false)
    expect(isUrlIconKey(undefined)).toBe(false)
    expect(isUrlIconKey(null)).toBe(false)
  })

  it('urlIconSrc returns the link, and null for a tampered key', () => {
    expect(urlIconSrc(`url:${SELFHST}`)).toBe(SELFHST)
    expect(urlIconSrc(`url:${MEDIA}`)).toBe(MEDIA)
    expect(urlIconSrc('url:javascript:alert(1)')).toBeNull()
    expect(urlIconSrc('brand:plex')).toBeNull()
  })

  it('urlIconLabel uses the last path segment without extension', () => {
    expect(urlIconLabel(`url:${SELFHST}`)).toBe('immich')
    expect(urlIconLabel('url:https://example.com/')).toBe('custom')
    expect(urlIconLabel('url:https://example.com/my%20logo.webp')).toBe('my logo')
  })

  it('isImageIconKey covers brand and valid url keys only', () => {
    expect(isImageIconKey('brand:plex')).toBe(true)
    expect(isImageIconKey(`url:${SELFHST}`)).toBe(true)
    expect(isImageIconKey('url:javascript:alert(1)')).toBe(false)
    expect(isImageIconKey('database')).toBe(false)
    expect(isImageIconKey(undefined)).toBe(false)
  })
})

describe('resolveCustomIcon with url keys', () => {
  it('resolves a valid link to a url icon', () => {
    expect(resolveCustomIcon(`url:${SELFHST}`)).toEqual({ kind: 'url', label: 'immich', url: SELFHST })
  })

  it('returns null for an unacceptable link', () => {
    expect(resolveCustomIcon('url:data:image/png;base64,AAAA')).toBeNull()
  })

  it('resolveNodeIcon falls back to the type icon for url keys', () => {
    expect(resolveNodeIcon(Server, `url:${SELFHST}`)).toBe(Server)
  })
})

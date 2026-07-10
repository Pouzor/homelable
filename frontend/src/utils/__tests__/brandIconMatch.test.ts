import { describe, it, expect } from 'vitest'
import { matchBrandIcon, shouldSkipNode } from '../brandIconMatch'

// Minimal slug list covering common homelab services + dark/light variants
const SLUGS = [
  'jellyfin',
  'nextcloud',
  'nextcloud-blue',
  'nextcloud-dark',
  'home-assistant',
  'home-assistant-alt',
  'proxmox',
  'proxmox-light',
  'bookstack',
  'grafana',
  'vaultwarden',
  'vaultwarden-light',
  'authentik',
  'gitea',
  'portainer',
  'portainer-dark',
  'semaphore',
  'semaphore-dark',
  'truenas',
  'truenas-scale',
  'truenas-core',
  'n8n',
  'qbittorrent',
  'uptime-kuma',
  'ntfy',
  'mariadb',
  'plex',
  'plex-light',
  'sonarr',
  'radarr',
  'adguard-home',
  'adguard-home-sync',
]

describe('matchBrandIcon — exact', () => {
  it('matches exact label (lowercase)', () => {
    expect(matchBrandIcon('jellyfin', SLUGS)).toMatchObject({ slug: 'jellyfin', confidence: 'exact' })
  })

  it('matches case-insensitive label', () => {
    expect(matchBrandIcon('Jellyfin', SLUGS)).toMatchObject({ slug: 'jellyfin', confidence: 'exact' })
    expect(matchBrandIcon('GRAFANA', SLUGS)).toMatchObject({ slug: 'grafana', confidence: 'exact' })
  })

  it('prefers plain slug over -dark/-light variant', () => {
    const m = matchBrandIcon('nextcloud', SLUGS)
    expect(m?.slug).toBe('nextcloud')
    expect(m?.confidence).toBe('exact')
  })

  it('matches vaultwarden', () => {
    expect(matchBrandIcon('Vaultwarden', SLUGS)).toMatchObject({ slug: 'vaultwarden', confidence: 'exact' })
  })

  it('matches n8n', () => {
    expect(matchBrandIcon('n8n', SLUGS)).toMatchObject({ slug: 'n8n', confidence: 'exact' })
  })
})

describe('matchBrandIcon — high (prefix / token)', () => {
  it('matches camelCase Home Assistant', () => {
    const m = matchBrandIcon('HomeAssistant', SLUGS)
    expect(m?.slug).toBe('home-assistant')
    expect(m?.confidence).toBe('high')
  })

  it('matches spaced "Home Assistant"', () => {
    const m = matchBrandIcon('Home Assistant', SLUGS)
    expect(m?.slug).toBe('home-assistant')
    expect(m?.confidence).toBe('high')
  })

  it('matches adguard-home via tokens', () => {
    const m = matchBrandIcon('adguard home', SLUGS)
    expect(m?.slug).toBe('adguard-home')
    expect(m).not.toBeNull()
  })

  it('matches uptime-kuma via prefix', () => {
    const m = matchBrandIcon('uptime-kuma', SLUGS)
    expect(m?.slug).toBe('uptime-kuma')
  })

  it('matches truenas (prefix of truenas-scale etc.)', () => {
    const m = matchBrandIcon('TrueNAS', SLUGS)
    expect(m?.slug).toBe('truenas')
  })
})

describe('matchBrandIcon — no match', () => {
  it('returns null for unknown service', () => {
    expect(matchBrandIcon('xyzunknownservice', SLUGS)).toBeNull()
  })

  it('returns null for empty label', () => {
    expect(matchBrandIcon('', SLUGS)).toBeNull()
  })

  it('returns null for very short token that would cause noise', () => {
    // 'ap' is only 2 chars — should not match partial slugs with "ap" in them
    expect(matchBrandIcon('ap', SLUGS)).toBeNull()
  })
})

describe('shouldSkipNode', () => {
  it('skips group types', () => {
    expect(shouldSkipNode('group')).toBe(true)
    expect(shouldSkipNode('groupRect')).toBe(true)
    expect(shouldSkipNode('text')).toBe(true)
  })

  it('skips nodes that already have a brand icon', () => {
    expect(shouldSkipNode('server', 'brand:proxmox')).toBe(true)
  })

  it('does not skip nodes with a lucide icon (non-brand)', () => {
    expect(shouldSkipNode('server', 'server')).toBe(false)
  })

  it('does not skip regular nodes without a brand icon', () => {
    expect(shouldSkipNode('lxc')).toBe(false)
    expect(shouldSkipNode('server')).toBe(false)
    expect(shouldSkipNode('generic')).toBe(false)
  })
})

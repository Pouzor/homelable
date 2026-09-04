import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  BASE_PATH,
  API_BASE_URL,
  normalizeBasePath,
  withBase,
  resolveServerPath,
  isLiveViewPath,
} from '@/utils/basePath'

const SUB = '/homelab/'

describe('normalizeBasePath', () => {
  it('falls back to the root for an empty or missing value', () => {
    expect(normalizeBasePath(undefined)).toBe('/')
    expect(normalizeBasePath(null)).toBe('/')
    expect(normalizeBasePath('')).toBe('/')
    expect(normalizeBasePath('   ')).toBe('/')
    expect(normalizeBasePath('/')).toBe('/')
  })

  it('adds the leading and trailing slash', () => {
    expect(normalizeBasePath('homelab')).toBe('/homelab/')
    expect(normalizeBasePath('/homelab')).toBe('/homelab/')
    expect(normalizeBasePath('homelab/')).toBe('/homelab/')
    expect(normalizeBasePath('/homelab/')).toBe('/homelab/')
  })

  it('keeps nested prefixes and collapses duplicate slashes', () => {
    expect(normalizeBasePath('/apps/homelab')).toBe('/apps/homelab/')
    expect(normalizeBasePath('//apps//homelab//')).toBe('/apps/homelab/')
  })
})

describe('default (root) base', () => {
  it('is the root, so every helper returns the pre-base-path string', () => {
    expect(BASE_PATH).toBe('/')
    expect(API_BASE_URL).toBe('/api/v1')
    expect(withBase('view')).toBe('/view')
    expect(withBase('brand/homelable.svg')).toBe('/brand/homelable.svg')
    expect(isLiveViewPath('/view')).toBe(true)
    expect(isLiveViewPath('/')).toBe(false)
    expect(resolveServerPath('/api/v1/media/abc.png')).toBe('/api/v1/media/abc.png')
  })
})

describe('withBase', () => {
  it('joins onto the base with exactly one slash', () => {
    expect(withBase('view', SUB)).toBe('/homelab/view')
    expect(withBase('/view', SUB)).toBe('/homelab/view')
    expect(withBase('//view', SUB)).toBe('/homelab/view')
    expect(withBase('', SUB)).toBe('/homelab/')
  })

  it('keeps the query string intact', () => {
    expect(withBase('view?key=abc&design=1', SUB)).toBe('/homelab/view?key=abc&design=1')
  })
})

describe('resolveServerPath', () => {
  it('prefixes root-absolute paths the backend returns', () => {
    expect(resolveServerPath('/api/v1/media/abc.png', SUB)).toBe('/homelab/api/v1/media/abc.png')
    expect(resolveServerPath('/api/v1/auth/oidc/login', SUB)).toBe('/homelab/api/v1/auth/oidc/login')
  })

  it('leaves an already-prefixed path alone', () => {
    expect(resolveServerPath('/homelab/api/v1/media/abc.png', SUB)).toBe('/homelab/api/v1/media/abc.png')
    expect(resolveServerPath('/homelab', SUB)).toBe('/homelab')
  })

  it('leaves anything that is not a root-absolute path alone', () => {
    expect(resolveServerPath('data:image/png;base64,AAAA', SUB)).toBe('data:image/png;base64,AAAA')
    expect(resolveServerPath('blob:http://x/y', SUB)).toBe('blob:http://x/y')
    expect(resolveServerPath('https://cdn.example/x.svg', SUB)).toBe('https://cdn.example/x.svg')
    expect(resolveServerPath('//cdn.example/x.svg', SUB)).toBe('//cdn.example/x.svg')
    expect(resolveServerPath('relative/x.svg', SUB)).toBe('relative/x.svg')
    expect(resolveServerPath('', SUB)).toBe('')
  })
})

describe('isLiveViewPath', () => {
  it('matches the live view under the base only', () => {
    expect(isLiveViewPath('/homelab/view', SUB)).toBe(true)
    expect(isLiveViewPath('/view', SUB)).toBe(false)
    expect(isLiveViewPath('/homelab/', SUB)).toBe(false)
    expect(isLiveViewPath('/homelab/viewer', SUB)).toBe(false)
  })
})

describe('module wiring', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('derives BASE_PATH and API_BASE_URL from import.meta.env.BASE_URL', async () => {
    vi.stubEnv('BASE_URL', '/homelab/')
    vi.resetModules()
    const mod = await import('@/utils/basePath')
    expect(mod.BASE_PATH).toBe('/homelab/')
    expect(mod.API_BASE_URL).toBe('/homelab/api/v1')
    expect(mod.withBase('view')).toBe('/homelab/view')
    expect(mod.isLiveViewPath('/homelab/view')).toBe(true)
    expect(mod.resolveServerPath('/api/v1/media/a.png')).toBe('/homelab/api/v1/media/a.png')
  })
})

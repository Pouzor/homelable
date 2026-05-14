import { describe, it, expect, vi, beforeEach } from 'vitest'

type Interceptor<T> = {
  fulfilled?: (v: T) => T | Promise<T>
  rejected?: (e: unknown) => unknown
}

interface MockInstance {
  defaults: { baseURL?: string }
  interceptors: {
    request: { use: (f: Interceptor<unknown>['fulfilled'], r?: Interceptor<unknown>['rejected']) => void }
    response: { use: (f: Interceptor<unknown>['fulfilled'], r?: Interceptor<unknown>['rejected']) => void }
  }
  get: ReturnType<typeof vi.fn>
  post: ReturnType<typeof vi.fn>
  patch: ReturnType<typeof vi.fn>
  delete: ReturnType<typeof vi.fn>
  __req: Interceptor<{ headers: Record<string, string> }>
  __res: Interceptor<unknown>
}

const hoisted = vi.hoisted(() => ({ instances: [] as unknown[] }))
const instances = hoisted.instances as MockInstance[]

vi.mock('axios', () => {
  return {
    default: {
      create: (cfg: { baseURL?: string }) => {
        const inst: MockInstance = {
          defaults: { baseURL: cfg?.baseURL },
          interceptors: {
            request: { use: (f: unknown, r?: unknown) => { inst.__req = { fulfilled: f as never, rejected: r as never } } },
            response: { use: (f: unknown, r?: unknown) => { inst.__res = { fulfilled: f as never, rejected: r as never } } },
          },
          get: vi.fn(() => Promise.resolve({ data: {} })),
          post: vi.fn(() => Promise.resolve({ data: {} })),
          patch: vi.fn(() => Promise.resolve({ data: {} })),
          delete: vi.fn(() => Promise.resolve({ data: {} })),
          __req: {},
          __res: {},
        }
        hoisted.instances.push(inst)
        return inst
      },
    },
  }
})

import { useAuthStore } from '@/stores/authStore'
import * as clientModule from '../client'

describe('api/client', () => {
  const mod = clientModule
  const [api, publicApi] = instances

  beforeEach(() => {
    useAuthStore.setState({ token: null, isAuthenticated: false })
    api.get.mockClear()
    api.post.mockClear()
    api.patch.mockClear()
    api.delete.mockClear()
    publicApi.get.mockClear()
    publicApi.post.mockClear()
  })

  it('creates two axios instances with /api/v1 baseURL', () => {
    expect(instances).toHaveLength(2)
    expect(api.defaults.baseURL).toBe('/api/v1')
    expect(publicApi.defaults.baseURL).toBe('/api/v1')
  })

  it('exports `api` matching the first created instance', () => {
    expect(mod.api).toBe(api)
  })

  it('request interceptor adds Authorization header when token present', () => {
    useAuthStore.setState({ token: 'tok-123', isAuthenticated: true })
    const cfg = { headers: {} as Record<string, string> }
    const out = api.__req.fulfilled!(cfg)
    expect((out as typeof cfg).headers.Authorization).toBe('Bearer tok-123')
  })

  it('request interceptor leaves headers untouched when no token', () => {
    const cfg = { headers: {} as Record<string, string> }
    const out = api.__req.fulfilled!(cfg)
    expect((out as typeof cfg).headers.Authorization).toBeUndefined()
  })

  it('response interceptor passes through 2xx responses', () => {
    const r = { status: 200, data: { ok: true } }
    expect(api.__res.fulfilled!(r)).toBe(r)
  })

  it('response interceptor calls logout on 401', async () => {
    const logout = vi.spyOn(useAuthStore.getState(), 'logout')
    useAuthStore.setState({ token: 't', isAuthenticated: true, logout })
    const err = { response: { status: 401 } }
    await expect(api.__res.rejected!(err)).rejects.toBe(err)
    expect(logout).toHaveBeenCalled()
  })

  it('response interceptor does not call logout on non-401', async () => {
    const logout = vi.fn()
    useAuthStore.setState({ token: 't', isAuthenticated: true, logout })
    const err = { response: { status: 500 } }
    await expect(api.__res.rejected!(err)).rejects.toBe(err)
    expect(logout).not.toHaveBeenCalled()
  })

  it('response interceptor handles error with no response object', async () => {
    const logout = vi.fn()
    useAuthStore.setState({ logout })
    const err = { message: 'network down' }
    await expect(api.__res.rejected!(err)).rejects.toBe(err)
    expect(logout).not.toHaveBeenCalled()
  })

  it('publicApi has no request/response interceptors registered', () => {
    expect(publicApi.__req.fulfilled).toBeUndefined()
    expect(publicApi.__res.fulfilled).toBeUndefined()
  })

  it('authApi.login posts to /auth/login', () => {
    mod.authApi.login('u', 'p')
    expect(api.post).toHaveBeenCalledWith('/auth/login', { username: 'u', password: 'p' })
  })

  it('canvasApi.load GETs /canvas', () => {
    mod.canvasApi.load()
    expect(api.get).toHaveBeenCalledWith('/canvas')
  })

  it('canvasApi.save POSTs to /canvas/save with payload', () => {
    const payload = { nodes: [], edges: [], viewport: {} }
    mod.canvasApi.save(payload)
    expect(api.post).toHaveBeenCalledWith('/canvas/save', payload)
  })

  it('nodesApi CRUD calls correct endpoints', () => {
    mod.nodesApi.create({ a: 1 })
    expect(api.post).toHaveBeenCalledWith('/nodes', { a: 1 })
    mod.nodesApi.update('n1', { b: 2 })
    expect(api.patch).toHaveBeenCalledWith('/nodes/n1', { b: 2 })
    mod.nodesApi.delete('n1')
    expect(api.delete).toHaveBeenCalledWith('/nodes/n1')
  })

  it('edgesApi CRUD calls correct endpoints', () => {
    mod.edgesApi.create({ s: 'a', t: 'b' })
    expect(api.post).toHaveBeenCalledWith('/edges', { s: 'a', t: 'b' })
    mod.edgesApi.delete('e1')
    expect(api.delete).toHaveBeenCalledWith('/edges/e1')
  })

  it('liveviewApi.load uses publicApi with key param', () => {
    mod.liveviewApi.load('k-1')
    expect(publicApi.get).toHaveBeenCalledWith('/liveview', { params: { key: 'k-1' } })
    expect(api.get).not.toHaveBeenCalled()
  })

  it('scanApi endpoints route correctly', () => {
    mod.scanApi.trigger()
    expect(api.post).toHaveBeenCalledWith('/scan/trigger')
    mod.scanApi.pending()
    expect(api.get).toHaveBeenCalledWith('/scan/pending')
    mod.scanApi.hidden()
    expect(api.get).toHaveBeenCalledWith('/scan/hidden')
    mod.scanApi.runs()
    expect(api.get).toHaveBeenCalledWith('/scan/runs')
    mod.scanApi.clearPending()
    expect(api.delete).toHaveBeenCalledWith('/scan/pending')
    mod.scanApi.approve('d1', { foo: 'bar' })
    expect(api.post).toHaveBeenCalledWith('/scan/pending/d1/approve', { foo: 'bar' })
    mod.scanApi.hide('d1')
    expect(api.post).toHaveBeenCalledWith('/scan/pending/d1/hide')
    mod.scanApi.ignore('d1')
    expect(api.post).toHaveBeenCalledWith('/scan/pending/d1/ignore')
    mod.scanApi.bulkApprove(['a', 'b'])
    expect(api.post).toHaveBeenCalledWith('/scan/pending/bulk-approve', { device_ids: ['a', 'b'] })
    mod.scanApi.bulkHide(['a'])
    expect(api.post).toHaveBeenCalledWith('/scan/pending/bulk-hide', { device_ids: ['a'] })
    mod.scanApi.restore('d1')
    expect(api.post).toHaveBeenCalledWith('/scan/pending/d1/restore')
    mod.scanApi.bulkRestore(['a'])
    expect(api.post).toHaveBeenCalledWith('/scan/pending/bulk-restore', { device_ids: ['a'] })
    mod.scanApi.stop('run-1')
    expect(api.post).toHaveBeenCalledWith('/scan/run-1/stop')
    mod.scanApi.getConfig()
    expect(api.get).toHaveBeenCalledWith('/scan/config')
    mod.scanApi.saveConfig({ ranges: ['1.0/24'] })
    expect(api.post).toHaveBeenCalledWith('/scan/config', { ranges: ['1.0/24'] })
  })

  it('settingsApi get/save', () => {
    mod.settingsApi.get()
    expect(api.get).toHaveBeenCalledWith('/settings')
    mod.settingsApi.save({ interval_seconds: 30 })
    expect(api.post).toHaveBeenCalledWith('/settings', { interval_seconds: 30 })
  })

  it('zigbeeApi.testConnection/importNetwork/importToPending', () => {
    const cfg = { mqtt_host: 'h', mqtt_port: 1883 }
    mod.zigbeeApi.testConnection(cfg)
    expect(api.post).toHaveBeenCalledWith('/zigbee/test-connection', cfg)
    mod.zigbeeApi.importNetwork(cfg)
    expect(api.post).toHaveBeenCalledWith('/zigbee/import', cfg)
    mod.zigbeeApi.importToPending(cfg)
    expect(api.post).toHaveBeenCalledWith('/zigbee/import-pending', cfg)
  })
})

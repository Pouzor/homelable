import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useStatusPolling } from '../useStatusPolling'

// Served under /homelab/ — the WebSocket URL has to carry the prefix too, or it
// lands on whatever else owns the root of the origin.
vi.mock('@/utils/basePath', () => ({ API_BASE_URL: '/homelab/api/v1' }))

vi.mock('@/stores/canvasStore', () => ({
  useCanvasStore: () => ({
    setNodeStatus: vi.fn(),
    notifyScanDeviceFound: vi.fn(),
    setServiceStatuses: vi.fn(),
  }),
}))

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => ({ isAuthenticated: true, authMethod: 'local', token: 'test-token' }),
}))

class MockWebSocket {
  static instances: MockWebSocket[] = []
  url: string
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onerror: ((e: unknown) => void) | null = null
  send = vi.fn()
  close = vi.fn()

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
  }
}

describe('useStatusPolling under a base path', () => {
  beforeEach(() => {
    MockWebSocket.instances = []
    vi.stubGlobal('WebSocket', MockWebSocket)
    Object.defineProperty(window, 'location', {
      value: { protocol: 'http:', host: 'home.example' },
      writable: true,
    })
  })

  afterEach(() => vi.restoreAllMocks())

  it('prefixes the WebSocket URL with the base path', () => {
    renderHook(() => useStatusPolling())
    expect(MockWebSocket.instances).toHaveLength(1)
    expect(MockWebSocket.instances[0].url).toBe('ws://home.example/homelab/api/v1/status/ws/status')
  })
})

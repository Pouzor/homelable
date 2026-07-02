import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useStatusPolling } from '../useStatusPolling'
import { useCanvasStore } from '@/stores/canvasStore'
import { useAuthStore } from '@/stores/authStore'

vi.mock('@/stores/canvasStore')
vi.mock('@/stores/authStore')

const mockUpdateNode = vi.fn()
const mockNotifyScanDeviceFound = vi.fn()
const mockSetServiceStatuses = vi.fn()

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

describe('useStatusPolling', () => {
  beforeEach(() => {
    MockWebSocket.instances = []
    vi.stubGlobal('WebSocket', MockWebSocket)

    vi.mocked(useCanvasStore).mockReturnValue({
      updateNode: mockUpdateNode,
      notifyScanDeviceFound: mockNotifyScanDeviceFound,
      setServiceStatuses: mockSetServiceStatuses,
    } as ReturnType<typeof useCanvasStore>)

    vi.mocked(useAuthStore).mockReturnValue({
      isAuthenticated: true,
      token: 'test-token',
    } as ReturnType<typeof useAuthStore>)

    Object.defineProperty(window, 'location', {
      value: { protocol: 'http:', host: 'localhost:5173' },
      writable: true,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    mockUpdateNode.mockClear()
    mockNotifyScanDeviceFound.mockClear()
    mockSetServiceStatuses.mockClear()
  })

  it('does not open WebSocket when not authenticated', () => {
    vi.mocked(useAuthStore).mockReturnValue({
      isAuthenticated: false,
      token: null,
    } as ReturnType<typeof useAuthStore>)
    renderHook(() => useStatusPolling())
    expect(MockWebSocket.instances).toHaveLength(0)
  })

  it('does not open WebSocket when token is missing', () => {
    vi.mocked(useAuthStore).mockReturnValue({
      isAuthenticated: true,
      token: null,
    } as ReturnType<typeof useAuthStore>)
    renderHook(() => useStatusPolling())
    expect(MockWebSocket.instances).toHaveLength(0)
  })

  it('connects to correct ws:// URL', () => {
    renderHook(() => useStatusPolling())
    expect(MockWebSocket.instances).toHaveLength(1)
    expect(MockWebSocket.instances[0].url).toBe('ws://localhost:5173/api/v1/status/ws/status')
  })

  it('uses wss:// when page is served over https', () => {
    Object.defineProperty(window, 'location', {
      value: { protocol: 'https:', host: 'mylab.local' },
      writable: true,
    })
    renderHook(() => useStatusPolling())
    expect(MockWebSocket.instances[0].url).toMatch(/^wss:\/\//)
  })

  it('sends token as first message on open', () => {
    renderHook(() => useStatusPolling())
    const ws = MockWebSocket.instances[0]
    ws.onopen?.()
    expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ token: 'test-token' }))
  })

  it('calls updateNode with correct data on status message', () => {
    renderHook(() => useStatusPolling())
    const ws = MockWebSocket.instances[0]
    ws.onmessage?.({
      data: JSON.stringify({
        node_id: 'node-1',
        status: 'online',
        checked_at: '2024-01-01T12:00:00Z',
        response_time_ms: 42,
      }),
    })
    expect(mockUpdateNode).toHaveBeenCalledWith('node-1', {
      status: 'online',
      response_time_ms: 42,
      last_seen: '2024-01-01T12:00:00Z',
    })
  })

  it('sets last_seen to undefined when status is offline', () => {
    renderHook(() => useStatusPolling())
    const ws = MockWebSocket.instances[0]
    ws.onmessage?.({
      data: JSON.stringify({
        node_id: 'node-1',
        status: 'offline',
        checked_at: '2024-01-01T12:00:00Z',
      }),
    })
    expect(mockUpdateNode).toHaveBeenCalledWith('node-1', {
      status: 'offline',
      response_time_ms: undefined,
      last_seen: undefined,
    })
  })

  it('sets response_time_ms to undefined when null in message', () => {
    renderHook(() => useStatusPolling())
    const ws = MockWebSocket.instances[0]
    ws.onmessage?.({
      data: JSON.stringify({ node_id: 'node-1', status: 'online', response_time_ms: null }),
    })
    expect(mockUpdateNode).toHaveBeenCalledWith(
      'node-1',
      expect.objectContaining({ response_time_ms: undefined }),
    )
  })

  it('calls notifyScanDeviceFound on scan_device_found message', () => {
    renderHook(() => useStatusPolling())
    const ws = MockWebSocket.instances[0]
    ws.onmessage?.({ data: JSON.stringify({ type: 'scan_device_found' }) })
    expect(mockNotifyScanDeviceFound).toHaveBeenCalledOnce()
    expect(mockUpdateNode).not.toHaveBeenCalled()
  })

  it('routes service_status messages to setServiceStatuses', () => {
    renderHook(() => useStatusPolling())
    const ws = MockWebSocket.instances[0]
    const services = [{ port: 80, protocol: 'tcp', status: 'offline' }]
    ws.onmessage?.({
      data: JSON.stringify({ type: 'service_status', node_id: 'node-9', services }),
    })
    expect(mockSetServiceStatuses).toHaveBeenCalledWith('node-9', services)
    expect(mockUpdateNode).not.toHaveBeenCalled()
  })

  it('ignores malformed JSON without throwing', () => {
    renderHook(() => useStatusPolling())
    const ws = MockWebSocket.instances[0]
    expect(() => ws.onmessage?.({ data: 'not-valid-json{{' })).not.toThrow()
    expect(mockUpdateNode).not.toHaveBeenCalled()
  })

  it('ignores messages with no node_id or status', () => {
    renderHook(() => useStatusPolling())
    const ws = MockWebSocket.instances[0]
    ws.onmessage?.({ data: JSON.stringify({ some: 'unknown-field' }) })
    expect(mockUpdateNode).not.toHaveBeenCalled()
  })

  it('closes WebSocket on unmount', () => {
    const { unmount } = renderHook(() => useStatusPolling())
    const ws = MockWebSocket.instances[0]
    unmount()
    expect(ws.close).toHaveBeenCalledOnce()
  })
})

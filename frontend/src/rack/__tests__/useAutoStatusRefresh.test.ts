import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useAutoStatusRefresh } from '../useAutoStatusRefresh'
import { useRackStore } from '../store'
import type { RackDevice } from '@/types'

vi.mock('@/api/client', () => ({
  racksApi: { load: vi.fn(), inventory: vi.fn(), save: vi.fn() },
  scanApi: { createPending: vi.fn(), pending: vi.fn(), hidden: vi.fn() },
}))

const refreshInventory = vi.fn().mockResolvedValue(undefined)

function mount(status: RackDevice['status']): RackDevice {
  return {
    id: 'd1',
    rackId: 'r1',
    deviceId: 'inv-1',
    nodeId: 'node-1',
    label: 'nas',
    uStart: 1,
    uHeight: 1,
    colStart: 0,
    colSpan: 12,
    faceplateId: 'server-1u',
    status,
    ports: [],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  useRackStore.setState({ refreshInventory })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useAutoStatusRefresh', () => {
  it('polls the inventory while a mount follows its node', () => {
    useRackStore.setState({ devices: [mount('auto')] })
    renderHook(() => useAutoStatusRefresh(1000))

    vi.advanceTimersByTime(3000)
    expect(refreshInventory).toHaveBeenCalledTimes(3)
  })

  it('stays quiet when every mount pins its own status', () => {
    // Nothing to refresh for: the LEDs are what the user set, and a needless
    // poll would hit the backend on every rack canvas ever opened.
    useRackStore.setState({ devices: [mount('online'), mount('unknown')] })
    renderHook(() => useAutoStatusRefresh(1000))

    vi.advanceTimersByTime(5000)
    expect(refreshInventory).not.toHaveBeenCalled()
  })

  it('stops polling once unmounted', () => {
    useRackStore.setState({ devices: [mount('auto')] })
    const { unmount } = renderHook(() => useAutoStatusRefresh(1000))

    vi.advanceTimersByTime(1000)
    unmount()
    vi.advanceTimersByTime(5000)
    expect(refreshInventory).toHaveBeenCalledTimes(1)
  })
})

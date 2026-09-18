import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useScanRunning } from '../useScanRunning'
import { scanApi } from '@/api/client'

vi.mock('@/api/client', () => ({
  scanApi: { runs: vi.fn() },
}))

const runs = vi.mocked(scanApi.runs)

function run(status: string) {
  return { id: status, status, kind: 'network', ranges: [], devices_found: 0, started_at: '', finished_at: null, error: null }
}

describe('useScanRunning', () => {
  beforeEach(() => {
    runs.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('is false until the first poll answers', () => {
    runs.mockResolvedValue({ data: [] } as never)
    const { result } = renderHook(() => useScanRunning())
    expect(result.current).toBe(false)
  })

  it('reports a running scan', async () => {
    runs.mockResolvedValue({ data: [run('done'), run('running')] } as never)
    const { result } = renderHook(() => useScanRunning())
    await waitFor(() => expect(result.current).toBe(true))
  })

  it('stays false when every run has finished', async () => {
    runs.mockResolvedValue({ data: [run('done'), run('error'), run('cancelled')] } as never)
    const { result } = renderHook(() => useScanRunning())
    await waitFor(() => expect(runs).toHaveBeenCalled())
    expect(result.current).toBe(false)
  })

  it('flips back to false once the run finishes', async () => {
    vi.useFakeTimers()
    runs.mockResolvedValue({ data: [run('running')] } as never)
    const { result } = renderHook(() => useScanRunning())
    await act(async () => { await Promise.resolve() })
    expect(result.current).toBe(true)

    runs.mockResolvedValue({ data: [run('done')] } as never)
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(result.current).toBe(false)
  })

  it('treats a failed poll as "nothing running"', async () => {
    runs.mockRejectedValue(new Error('offline'))
    const { result } = renderHook(() => useScanRunning())
    await waitFor(() => expect(runs).toHaveBeenCalled())
    expect(result.current).toBe(false)
  })

  it('stops polling after unmount', async () => {
    vi.useFakeTimers()
    runs.mockResolvedValue({ data: [] } as never)
    const { unmount } = renderHook(() => useScanRunning())
    await act(async () => { await Promise.resolve() })
    expect(runs).toHaveBeenCalledTimes(1)
    unmount()
    await act(async () => { await vi.advanceTimersByTimeAsync(15000) })
    expect(runs).toHaveBeenCalledTimes(1)
  })
})

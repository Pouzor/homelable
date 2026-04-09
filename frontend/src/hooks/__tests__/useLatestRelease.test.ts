import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

// Reset module between tests so the module-level cache is cleared
async function freshHook() {
  vi.resetModules()
  const mod = await import('../useLatestRelease')
  return mod.useLatestRelease
}

const CURRENT = '1.8.3'

function mockFetch(payload: unknown, ok = true) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok,
      json: () => Promise.resolve(payload),
    }),
  )
}

describe('useLatestRelease', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns no update when latest version matches current', async () => {
    mockFetch({ tag_name: 'v1.8.3', html_url: 'https://github.com/Pouzor/homelable/releases/tag/v1.8.3' })
    const useLatestRelease = await freshHook()
    const { result } = renderHook(() => useLatestRelease(CURRENT))
    await waitFor(() => expect(result.current.latest).not.toBeNull())
    expect(result.current.hasUpdate).toBe(false)
  })

  it('returns update when latest version is newer', async () => {
    mockFetch({ tag_name: 'v1.9.0', html_url: 'https://github.com/Pouzor/homelable/releases/tag/v1.9.0' })
    const useLatestRelease = await freshHook()
    const { result } = renderHook(() => useLatestRelease(CURRENT))
    await waitFor(() => expect(result.current.hasUpdate).toBe(true))
    expect(result.current.latest?.version).toBe('1.9.0')
    expect(result.current.latest?.url).toBe('https://github.com/Pouzor/homelable/releases/tag/v1.9.0')
  })

  it('strips leading v from tag_name', async () => {
    mockFetch({ tag_name: 'v2.0.0', html_url: 'https://github.com/example' })
    const useLatestRelease = await freshHook()
    const { result } = renderHook(() => useLatestRelease(CURRENT))
    await waitFor(() => expect(result.current.latest).not.toBeNull())
    expect(result.current.latest?.version).toBe('2.0.0')
  })

  it('does not show update when API returns non-ok response', async () => {
    mockFetch({ message: 'Not Found' }, false)
    const useLatestRelease = await freshHook()
    const { result } = renderHook(() => useLatestRelease(CURRENT))
    await new Promise((r) => setTimeout(r, 50))
    expect(result.current.hasUpdate).toBe(false)
    expect(result.current.latest).toBeNull()
  })

  it('does not show update when API returns missing tag_name', async () => {
    mockFetch({ html_url: 'https://github.com/example' })
    const useLatestRelease = await freshHook()
    const { result } = renderHook(() => useLatestRelease(CURRENT))
    await new Promise((r) => setTimeout(r, 50))
    expect(result.current.hasUpdate).toBe(false)
  })

  it('does not show update when API returns missing html_url', async () => {
    mockFetch({ tag_name: 'v2.0.0' })
    const useLatestRelease = await freshHook()
    const { result } = renderHook(() => useLatestRelease(CURRENT))
    await new Promise((r) => setTimeout(r, 50))
    expect(result.current.hasUpdate).toBe(false)
  })

  it('does not show update when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')))
    const useLatestRelease = await freshHook()
    const { result } = renderHook(() => useLatestRelease(CURRENT))
    await new Promise((r) => setTimeout(r, 50))
    expect(result.current.hasUpdate).toBe(false)
  })

  it('fetches only once when hook is mounted multiple times concurrently', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ tag_name: 'v1.8.3', html_url: 'https://github.com' }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const useLatestRelease = await freshHook()
    // Mount all three before the fetch resolves — cache is set to 'pending' after first mount
    const a = renderHook(() => useLatestRelease(CURRENT))
    const b = renderHook(() => useLatestRelease(CURRENT))
    const c = renderHook(() => useLatestRelease(CURRENT))
    await waitFor(() => {
      expect(a.result.current.latest).not.toBeNull()
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    // All hooks see the same result once cache resolves
    expect(b.result.current.hasUpdate).toBe(false)
    expect(c.result.current.hasUpdate).toBe(false)
  })
})

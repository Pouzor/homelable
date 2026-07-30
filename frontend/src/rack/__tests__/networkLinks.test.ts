import { describe, it, expect, beforeEach, vi } from 'vitest'
import { loadNetworkLinks } from '../networkLinks'
import type { Design } from '@/types'

const canvasLoad = vi.fn()

vi.mock('@/api/client', () => ({
  canvasApi: { load: (...args: unknown[]) => canvasLoad(...args) },
}))

function design(id: string, design_type: Design['design_type'] = 'network'): Design {
  return { id, name: id, design_type, icon: null, created_at: '', updated_at: '' }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('loadNetworkLinks', () => {
  it('collects physical edges from a logical canvas', async () => {
    canvasLoad.mockResolvedValue({
      data: { edges: [{ source: 'a', target: 'b', type: 'ethernet', label: 'uplink' }] },
    })
    const hints = await loadNetworkLinks([design('d1')])
    expect(hints).toEqual([{ from: 'a', to: 'b', type: 'ethernet', label: 'uplink' }])
  })

  it('maps a fibre edge onto a fiber patch', async () => {
    canvasLoad.mockResolvedValue({ data: { edges: [{ source: 'a', target: 'b', type: 'fibre' }] } })
    const [hint] = await loadNetworkLinks([design('d1')])
    expect(hint.type).toBe('fiber')
  })

  it('skips links that are not physical', async () => {
    canvasLoad.mockResolvedValue({
      data: {
        edges: [
          { source: 'a', target: 'b', type: 'wifi' },
          { source: 'c', target: 'd', type: 'virtual' },
          { source: 'e', target: 'f', type: 'ethernet' },
        ],
      },
    })
    const hints = await loadNetworkLinks([design('d1')])
    expect(hints.map((h) => h.from)).toEqual(['e'])
  })

  it('never reads a rack design — it has no edges to import', async () => {
    canvasLoad.mockResolvedValue({ data: { edges: [] } })
    await loadNetworkLinks([design('d1', 'rack')])
    expect(canvasLoad).not.toHaveBeenCalled()
  })

  it('dedupes the same pair drawn on two canvases, either way round', async () => {
    canvasLoad
      .mockResolvedValueOnce({ data: { edges: [{ source: 'a', target: 'b', type: 'ethernet' }] } })
      .mockResolvedValueOnce({ data: { edges: [{ source: 'b', target: 'a', type: 'ethernet' }] } })
    const hints = await loadNetworkLinks([design('d1'), design('d2')])
    expect(hints).toHaveLength(1)
  })

  it('skips a design that fails to load instead of failing the import', async () => {
    canvasLoad
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ data: { edges: [{ source: 'a', target: 'b', type: 'ethernet' }] } })
    const hints = await loadNetworkLinks([design('d1'), design('d2')])
    expect(hints).toHaveLength(1)
  })
})

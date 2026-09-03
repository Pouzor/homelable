import { describe, it, expect } from 'vitest'
import {
  PORT_EDGE_INSET,
  clampPort,
  nextPortSpot,
  snapThreshold,
  snapToPeers,
} from '../portLayout'
import type { Port } from '@/types'

const port = (over: Partial<Port> = {}): Port => ({
  id: 'p1',
  label: 'p1',
  type: 'rj45',
  x: 0.5,
  y: 0.5,
  ...over,
})

describe('clampPort', () => {
  it('keeps a port off the edge of the plate, on both sides', () => {
    expect(clampPort({ x: -3, y: 2 })).toEqual({
      x: PORT_EDGE_INSET,
      y: 1 - PORT_EDGE_INSET,
    })
  })

  it('leaves a port inside the plate alone', () => {
    expect(clampPort({ x: 0.4, y: 0.6 })).toEqual({ x: 0.4, y: 0.6 })
  })
})

describe('snapThreshold', () => {
  it('converts the pixel threshold per axis, so a wide plate snaps evenly', () => {
    expect(snapThreshold(600, 60, 6)).toEqual({ x: 0.01, y: 0.1 })
  })

  it('reports no threshold for a plate that has not been measured yet', () => {
    expect(snapThreshold(0, 0)).toEqual({ x: 0, y: 0 })
  })
})

describe('snapToPeers', () => {
  const threshold = { x: 0.02, y: 0.05 }

  it('aligns onto the nearest peer column and reports the guide', () => {
    const result = snapToPeers({ x: 0.31, y: 0.8 }, [{ x: 0.3, y: 0.2 }], threshold)
    expect(result.x).toBe(0.3)
    expect(result.guideX).toBe(0.3)
    // The peer is far away vertically, so that axis stays free.
    expect(result.y).toBe(0.8)
    expect(result.guideY).toBeNull()
  })

  it('takes its column from one peer and its row from another', () => {
    const result = snapToPeers(
      { x: 0.405, y: 0.62 },
      [
        { x: 0.4, y: 0.1 },
        { x: 0.9, y: 0.6 },
      ],
      threshold,
    )
    expect(result).toMatchObject({ x: 0.4, y: 0.6, guideX: 0.4, guideY: 0.6 })
  })

  it('leaves a port that is out of reach of every peer where it was dropped', () => {
    const result = snapToPeers({ x: 0.5, y: 0.5 }, [{ x: 0.1, y: 0.1 }], threshold)
    expect(result).toEqual({ x: 0.5, y: 0.5, guideX: null, guideY: null })
  })

  it('clamps before snapping, so a drag off the plate cannot escape it', () => {
    const result = snapToPeers({ x: 5, y: -5 }, [], threshold)
    expect(result.x).toBe(1 - PORT_EDGE_INSET)
    expect(result.y).toBe(PORT_EDGE_INSET)
  })
})

describe('nextPortSpot', () => {
  it('centres the first port', () => {
    expect(nextPortSpot([])).toEqual({ x: 0.5, y: 0.5 })
  })

  it('continues the row rather than stacking on the last port', () => {
    const spot = nextPortSpot([port({ x: 0.2, y: 0.35 })])
    expect(spot.x).toBeGreaterThan(0.2)
    expect(spot.y).toBe(0.35)
  })

  it('wraps to a new row at the right edge', () => {
    const spot = nextPortSpot([port({ x: 0.98, y: 0.3 })])
    expect(spot.x).toBe(PORT_EDGE_INSET)
    expect(spot.y).toBeGreaterThan(0.3)
  })

  it('never wraps a bottom row off the plate', () => {
    const spot = nextPortSpot([port({ x: 0.98, y: 0.95 })])
    expect(spot.y).toBe(1 - PORT_EDGE_INSET)
  })
})

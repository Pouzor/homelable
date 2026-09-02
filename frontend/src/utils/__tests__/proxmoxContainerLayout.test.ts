import { describe, it, expect } from 'vitest'
import {
  CONTAINER_LAYOUT as C,
  groupProxmoxGuests,
  layoutProxmoxContainers,
  measureProxmoxContainers,
} from '@/utils/proxmoxContainerLayout'

const ORIGIN = { x: 100, y: 50 }

describe('layoutProxmoxContainers', () => {
  it('places a lone host at the origin with the minimum box size', () => {
    const { positions, hostSizes } = layoutProxmoxContainers(['h1'], { h1: [] }, [], ORIGIN)
    expect(positions.h1).toEqual(ORIGIN)
    expect(hostSizes.h1).toEqual({ width: C.minHostWidth, height: C.minHostHeight })
  })

  it('lays children out in rows inside the host, below its header band', () => {
    const kids = ['a', 'b', 'c', 'd']
    const { positions } = layoutProxmoxContainers(['h1'], { h1: kids }, [], ORIGIN)
    // maxCols is 3, so d starts the second row.
    expect(positions.a).toEqual({ x: ORIGIN.x + C.padX, y: ORIGIN.y + C.padTop })
    expect(positions.b.y).toBe(positions.a.y)
    expect(positions.c.y).toBe(positions.a.y)
    expect(positions.b.x - positions.a.x).toBe(C.childWidth + C.gapX)
    expect(positions.d).toEqual({
      x: ORIGIN.x + C.padX,
      y: ORIGIN.y + C.padTop + C.childHeight + C.gapY,
    })
  })

  it('grows the host box to fit its children', () => {
    const { hostSizes } = layoutProxmoxContainers(['h1'], { h1: ['a', 'b', 'c'] }, [], ORIGIN)
    expect(hostSizes.h1.width).toBe(C.padX * 2 + 3 * C.childWidth + 2 * C.gapX)
    expect(hostSizes.h1.height).toBe(C.minHostHeight)
  })

  it('every child sits inside its host box', () => {
    const kids = ['a', 'b', 'c', 'd', 'e']
    const { positions, hostSizes } = layoutProxmoxContainers(['h1'], { h1: kids }, [], ORIGIN)
    const host = positions.h1
    const size = hostSizes.h1
    for (const k of kids) {
      expect(positions[k].x).toBeGreaterThanOrEqual(host.x)
      expect(positions[k].y).toBeGreaterThanOrEqual(host.y)
      expect(positions[k].x + C.childWidth).toBeLessThanOrEqual(host.x + size.width)
      expect(positions[k].y + C.childHeight).toBeLessThanOrEqual(host.y + size.height)
    }
  })

  it('puts several hosts side by side without overlapping', () => {
    const { positions, hostSizes } = layoutProxmoxContainers(
      ['h1', 'h2'],
      { h1: ['a', 'b', 'c'], h2: [] },
      [],
      ORIGIN,
    )
    expect(positions.h1.y).toBe(positions.h2.y)
    expect(positions.h2.x).toBe(positions.h1.x + hostSizes.h1.width + C.hostGap)
  })

  it('drops loose nodes in a grid below the tallest host', () => {
    const kids = Array.from({ length: 7 }, (_, i) => `k${i}`)
    const { positions, hostSizes } = layoutProxmoxContainers(['h1'], { h1: kids }, ['x', 'y'], ORIGIN)
    const looseY = ORIGIN.y + hostSizes.h1.height + C.hostGap
    expect(positions.x).toEqual({ x: ORIGIN.x, y: looseY })
    expect(positions.y).toEqual({ x: ORIGIN.x + C.looseSpacingX, y: looseY })
  })

  it('lays loose nodes out at the origin when there is no host', () => {
    const { positions } = layoutProxmoxContainers([], {}, ['x'], ORIGIN)
    expect(positions.x).toEqual(ORIGIN)
  })
})

describe('measureProxmoxContainers', () => {
  it('covers the whole layout', () => {
    const hostIds = ['h1', 'h2']
    const childrenByHost = { h1: ['a', 'b'], h2: ['c'] }
    const size = measureProxmoxContainers(hostIds, childrenByHost, 3)
    const { positions, hostSizes } = layoutProxmoxContainers(
      hostIds,
      childrenByHost,
      ['l0', 'l1', 'l2'],
      { x: 0, y: 0 },
    )
    for (const [id, pos] of Object.entries(positions)) {
      const s = hostSizes[id]
      expect(pos.x + (s?.width ?? C.childWidth)).toBeLessThanOrEqual(size.width)
      expect(pos.y + (s?.height ?? C.childHeight)).toBeLessThanOrEqual(size.height)
    }
  })
})

describe('groupProxmoxGuests', () => {
  const host = { id: 'h1', type: 'proxmox' }
  const host2 = { id: 'h2', type: 'proxmox' }
  const vm = { id: 'v1', type: 'vm' }
  const lxc = { id: 'l1', type: 'lxc' }

  it('buckets guests under the host that runs them', () => {
    const g = groupProxmoxGuests([host, vm, lxc], [
      { source: 'h1', target: 'v1' },
      { source: 'h1', target: 'l1' },
    ])
    expect(g.hostIds).toEqual(['h1'])
    expect(g.childrenByHost).toEqual({ h1: ['v1', 'l1'] })
    expect(g.hostOfChild).toEqual({ v1: 'h1', l1: 'h1' })
    expect(g.looseIds).toEqual([])
  })

  it('gives a host with no guests an empty bucket', () => {
    const g = groupProxmoxGuests([host, host2, vm], [{ source: 'h1', target: 'v1' }])
    expect(g.childrenByHost).toEqual({ h1: ['v1'], h2: [] })
  })

  it('keeps the first host that claims a guest — a node has one parent', () => {
    const g = groupProxmoxGuests([host, host2, vm], [
      { source: 'h1', target: 'v1' },
      { source: 'h2', target: 'v1' },
    ])
    expect(g.childrenByHost).toEqual({ h1: ['v1'], h2: [] })
    expect(g.hostOfChild.v1).toBe('h1')
  })

  it('ignores host-to-host cluster links', () => {
    const g = groupProxmoxGuests([host, host2], [{ source: 'h1', target: 'h2' }])
    expect(g.childrenByHost).toEqual({ h1: [], h2: [] })
    expect(g.looseIds).toEqual([])
  })

  it('ignores an edge pointing outside the selection', () => {
    const g = groupProxmoxGuests([host, vm], [{ source: 'h1', target: 'not-selected' }])
    expect(g.childrenByHost).toEqual({ h1: [] })
    expect(g.looseIds).toEqual(['v1'])
  })

  it('treats a guest with no host in the selection as loose', () => {
    const g = groupProxmoxGuests([vm, lxc], [{ source: 'h1', target: 'v1' }])
    expect(g.hostIds).toEqual([])
    expect(g.looseIds).toEqual(['v1', 'l1'])
  })
})

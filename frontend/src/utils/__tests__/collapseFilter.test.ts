import { describe, it, expect } from 'vitest'
import type { Edge, Node } from '@xyflow/react'
import {
  getVisibleNodeIds,
  rewireEdgesForCollapse,
  getZoneSpatialChildren,
  computeCollapseInfo,
} from '../collapseFilter'
import type { EdgeData, NodeData } from '@/types'

interface MkOpts {
  parentId?: string
  collapsed?: boolean
  position?: { x: number; y: number }
  width?: number
  height?: number
  type?: NodeData['type']
}

// Outside the default 360x240 zone bbox at origin — used by tests that need
// a node that must NOT be spatially captured by a collapsed zone.
const FAR = { x: 10000, y: 0 }

const mkNode = (id: string, opts: MkOpts = {}): Node<NodeData> => ({
  id,
  position: opts.position ?? { x: 0, y: 0 },
  ...(opts.width !== undefined ? { width: opts.width } : {}),
  ...(opts.height !== undefined ? { height: opts.height } : {}),
  ...(opts.parentId ? { parentId: opts.parentId } : {}),
  data: {
    label: id,
    type: opts.type ?? (opts.parentId ? 'server' : 'groupRect'),
    status: 'online',
    services: [],
    ...(opts.collapsed !== undefined ? { collapsed: opts.collapsed } : {}),
  },
})

const mkEdge = (id: string, source: string, target: string): Edge<EdgeData> => ({
  id,
  source,
  target,
})

describe('getVisibleNodeIds — parentId cascade', () => {
  it('returns all nodes when nothing is collapsed', () => {
    const nodes = [
      mkNode('zone'),
      mkNode('child-a', { parentId: 'zone' }),
      mkNode('child-b', { parentId: 'zone' }),
    ]
    expect(getVisibleNodeIds(nodes)).toEqual(new Set(['zone', 'child-a', 'child-b']))
  })

  it('hides direct children of a collapsed parent but keeps the parent itself', () => {
    const nodes = [
      mkNode('zone', { collapsed: true }),
      mkNode('child-a', { parentId: 'zone' }),
      mkNode('child-b', { parentId: 'zone' }),
      mkNode('outside', { position: FAR }),
    ]
    expect(getVisibleNodeIds(nodes)).toEqual(new Set(['zone', 'outside']))
  })

  it('hides the entire subtree when an ancestor is collapsed (multi-level)', () => {
    const nodes = [
      mkNode('root', { collapsed: true }),
      mkNode('mid', { parentId: 'root', collapsed: false }),
      mkNode('leaf', { parentId: 'mid' }),
    ]
    const v = getVisibleNodeIds(nodes)
    expect(v.has('root')).toBe(true)
    expect(v.has('mid')).toBe(false)
    expect(v.has('leaf')).toBe(false)
  })

  it('hides only the nested subtree when an inner zone is collapsed', () => {
    const nodes = [
      mkNode('root', { collapsed: false }),
      mkNode('inner', { parentId: 'root', collapsed: true }),
      mkNode('leaf', { parentId: 'inner' }),
      mkNode('sibling', { parentId: 'root' }),
    ]
    expect(getVisibleNodeIds(nodes)).toEqual(new Set(['root', 'inner', 'sibling']))
  })

  it('handles a zone with no children', () => {
    expect(getVisibleNodeIds([mkNode('empty-zone', { collapsed: true })]))
      .toEqual(new Set(['empty-zone']))
  })

  it('returns an empty set for empty input', () => {
    expect(getVisibleNodeIds([])).toEqual(new Set())
  })

  it('treats nodes with no collapsed flag as expanded', () => {
    const nodes = [mkNode('zone'), mkNode('child', { parentId: 'zone' })]
    expect(getVisibleNodeIds(nodes)).toEqual(new Set(['zone', 'child']))
  })

  it('is independent of insertion order (children declared before parent)', () => {
    const nodes = [
      mkNode('child', { parentId: 'zone' }),
      mkNode('zone', { collapsed: true }),
    ]
    expect(getVisibleNodeIds(nodes)).toEqual(new Set(['zone']))
  })
})

describe('getZoneSpatialChildren', () => {
  it('picks up top-level nodes whose centre lies inside the zone bbox', () => {
    const zone = mkNode('zone', { position: { x: 0, y: 0 }, width: 400, height: 300 })
    const inside = mkNode('inside', { position: { x: 100, y: 50 }, type: 'server' })
    const outside = mkNode('outside', { position: { x: 500, y: 0 }, type: 'server' })
    expect(getZoneSpatialChildren(zone, [zone, inside, outside])).toEqual(['inside'])
  })

  it('ignores the zone itself', () => {
    const zone = mkNode('zone', { width: 400, height: 300 })
    expect(getZoneSpatialChildren(zone, [zone])).toEqual([])
  })

  it('ignores nodes with a parentId (handled via parentId cascade)', () => {
    const zone = mkNode('zone', { width: 400, height: 300 })
    const child = mkNode('child', { parentId: 'other', type: 'server' })
    expect(getZoneSpatialChildren(zone, [zone, child])).toEqual([])
  })

  it('uses fallback dimensions for nodes with no width/height set', () => {
    const zone = mkNode('zone', { width: 400, height: 300 })
    // No width/height → defaults (200, 80). Centre at (100, 40), inside.
    const n = mkNode('n', { type: 'server' })
    expect(getZoneSpatialChildren(zone, [zone, n])).toEqual(['n'])
  })
})

describe('computeCollapseInfo — spatial collapse via groupRect zones', () => {
  it('hides nodes spatially inside a collapsed zone and records hiddenBy', () => {
    const zone = mkNode('zone', { collapsed: true, width: 400, height: 300 })
    const inside = mkNode('inside', { position: { x: 50, y: 50 }, type: 'server' })
    const outside = mkNode('outside', { position: FAR, type: 'server' })
    const info = computeCollapseInfo([zone, inside, outside])
    expect(info.visibleIds).toEqual(new Set(['zone', 'outside']))
    expect(info.hiddenBy.get('inside')).toBe('zone')
  })

  it('cascades parentId descendants of spatially-hidden nodes', () => {
    // Proxmox host sitting inside a collapsed zone — its VMs (parentId)
    // must also be hidden even though they live at relative coords.
    const zone = mkNode('zone', { collapsed: true, width: 400, height: 300 })
    const px = mkNode('px', { position: { x: 50, y: 50 }, type: 'proxmox' })
    const vm = mkNode('vm', { parentId: 'px', type: 'vm' })
    const info = computeCollapseInfo([zone, px, vm])
    expect(info.visibleIds).toEqual(new Set(['zone']))
    expect(info.hiddenBy.get('vm')).toBe('zone')
  })

  it('a nested groupRect inside a collapsed outer zone is also hidden', () => {
    const outer = mkNode('outer', { collapsed: true, width: 600, height: 400 })
    const inner = mkNode('inner', { position: { x: 100, y: 100 }, width: 200, height: 150 })
    const leaf = mkNode('leaf', { position: { x: 150, y: 150 }, type: 'server' })
    const info = computeCollapseInfo([outer, inner, leaf])
    expect(info.visibleIds).toEqual(new Set(['outer']))
  })

  it('does not affect nodes outside every collapsed zone', () => {
    const a = mkNode('a', { collapsed: true, width: 300, height: 200 })
    const b = mkNode('b', { position: { x: 1000, y: 1000 }, width: 300, height: 200 })
    const free = mkNode('free', { position: { x: 2000, y: 2000 }, type: 'server' })
    const info = computeCollapseInfo([a, b, free])
    expect(info.visibleIds.has('free')).toBe(true)
  })
})

describe('rewireEdgesForCollapse', () => {
  it('keeps edges between two visible nodes unchanged (same reference)', () => {
    const nodes = [mkNode('a'), mkNode('b', { position: FAR })]
    const edges = [mkEdge('e1', 'a', 'b')]
    const info = computeCollapseInfo(nodes)
    const out = rewireEdgesForCollapse(edges, nodes, info.visibleIds, info.hiddenBy)
    expect(out).toHaveLength(1)
    expect(out[0]).toBe(edges[0])
  })

  it('keeps multiple parallel edges between two visible nodes (no dedupe)', () => {
    // Regression: parallel links between the same two visible devices must all
    // render. The seen-key dedupe applies only to rewired collapse stubs.
    const nodes = [mkNode('a'), mkNode('b', { position: FAR })]
    const edges = [mkEdge('e1', 'a', 'b'), mkEdge('e2', 'a', 'b'), mkEdge('e3', 'a', 'b')]
    const info = computeCollapseInfo(nodes)
    const out = rewireEdgesForCollapse(edges, nodes, info.visibleIds, info.hiddenBy)
    expect(out).toHaveLength(3)
    expect(out.map((e) => e.id)).toEqual(['e1', 'e2', 'e3'])
  })

  it('reroutes a cross-boundary edge to the collapsed parentId ancestor', () => {
    const nodes = [
      mkNode('zone', { collapsed: true }),
      mkNode('leaf', { parentId: 'zone' }),
      mkNode('outside', { position: FAR }),
    ]
    const info = computeCollapseInfo(nodes)
    const edges = [mkEdge('e1', 'outside', 'leaf')]
    const out = rewireEdgesForCollapse(edges, nodes, info.visibleIds, info.hiddenBy)
    expect(out[0].source).toBe('outside')
    expect(out[0].target).toBe('zone')
    expect(out[0].sourceHandle).toBeNull()
    expect(out[0].targetHandle).toBeNull()
  })

  it('reroutes a cross-boundary edge to a collapsed groupRect zone (spatial)', () => {
    const zone = mkNode('zone', { collapsed: true, width: 400, height: 300 })
    const inside = mkNode('inside', { position: { x: 50, y: 50 }, type: 'server' })
    const outside = mkNode('outside', { position: FAR, type: 'server' })
    const nodes = [zone, inside, outside]
    const info = computeCollapseInfo(nodes)
    const edges = [mkEdge('e1', 'outside', 'inside')]
    const out = rewireEdgesForCollapse(edges, nodes, info.visibleIds, info.hiddenBy)
    expect(out[0].source).toBe('outside')
    expect(out[0].target).toBe('zone')
  })

  it('drops an edge between two siblings inside the same collapsed zone (self-loop)', () => {
    const nodes = [
      mkNode('zone', { collapsed: true }),
      mkNode('a', { parentId: 'zone' }),
      mkNode('b', { parentId: 'zone' }),
    ]
    const info = computeCollapseInfo(nodes)
    expect(rewireEdgesForCollapse([mkEdge('e1', 'a', 'b')], nodes, info.visibleIds, info.hiddenBy))
      .toEqual([])
  })

  it('de-dupes parallel cross-boundary edges that rewire to the same pair', () => {
    const nodes = [
      mkNode('zone', { collapsed: true }),
      mkNode('coord', { position: FAR }),
      ...Array.from({ length: 5 }, (_, i) => mkNode(`leaf-${i}`, { parentId: 'zone' })),
    ]
    const info = computeCollapseInfo(nodes)
    const edges = Array.from({ length: 5 }, (_, i) => mkEdge(`e-${i}`, 'coord', `leaf-${i}`))
    const out = rewireEdgesForCollapse(edges, nodes, info.visibleIds, info.hiddenBy)
    expect(out).toHaveLength(1)
    expect(out[0].source).toBe('coord')
    expect(out[0].target).toBe('zone')
  })

  it('walks the chain to the nearest visible ancestor (nested collapse)', () => {
    const nodes = [
      mkNode('root', { collapsed: true }),
      mkNode('mid', { parentId: 'root' }),
      mkNode('leaf', { parentId: 'mid' }),
      mkNode('outside', { position: FAR }),
    ]
    const info = computeCollapseInfo(nodes)
    const out = rewireEdgesForCollapse(
      [mkEdge('e1', 'outside', 'leaf')],
      nodes,
      info.visibleIds,
      info.hiddenBy,
    )
    expect(out[0].target).toBe('root')
  })

  it('drops an edge whose endpoint has no visible ancestor', () => {
    const edges = [mkEdge('e1', 'ghost', 'also-ghost')]
    expect(rewireEdgesForCollapse(edges, [], new Set(), new Map())).toEqual([])
  })

  it('returns an empty array for empty input', () => {
    expect(rewireEdgesForCollapse([], [], new Set(), new Map())).toEqual([])
  })
})

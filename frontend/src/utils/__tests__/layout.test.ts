import { describe, it, expect } from 'vitest'
import { applyDagreLayout } from '../layout'
import type { Node, Edge } from '@xyflow/react'
import type { NodeData, EdgeData } from '@/types'

function makeNode(id: string, type: string, parentId?: string): Node<NodeData> {
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    data: { type, label: id } as unknown as NodeData,
    ...(parentId ? { parentId } : {}),
  }
}

function makeEdge(source: string, target: string, sourceHandle?: string): Edge<EdgeData> {
  return { id: `${source}-${target}`, source, target, sourceHandle, data: {} as EdgeData }
}

describe('applyDagreLayout', () => {
  it('places two proxmox nodes connected to each other at the same Y', () => {
    const nodes = [
      makeNode('router', 'router'),
      makeNode('pve1', 'proxmox'),
      makeNode('pve2', 'proxmox'),
    ]
    const edges = [
      makeEdge('router', 'pve1'),
      makeEdge('router', 'pve2'),
      makeEdge('pve1', 'pve2'),
    ]

    const result = applyDagreLayout(nodes, edges)
    const pve1 = result.find((n) => n.id === 'pve1')!
    const pve2 = result.find((n) => n.id === 'pve2')!

    expect(pve1.position.y).toBe(pve2.position.y)
  })

  it('orders peer nodes left-to-right by chain: endpoint first, middle last', () => {
    // pve-left -- pve-center -- pve-right  (chain)
    // router connects to all three
    const nodes = [
      makeNode('router', 'router'),
      makeNode('pve-left', 'proxmox'),
      makeNode('pve-center', 'proxmox'),
      makeNode('pve-right', 'proxmox'),
    ]
    const edges = [
      makeEdge('router', 'pve-left'),
      makeEdge('router', 'pve-center'),
      makeEdge('router', 'pve-right'),
      makeEdge('pve-left', 'pve-center'),
      makeEdge('pve-center', 'pve-right'),
    ]

    const result = applyDagreLayout(nodes, edges)
    const left = result.find((n) => n.id === 'pve-left')!
    const center = result.find((n) => n.id === 'pve-center')!
    const right = result.find((n) => n.id === 'pve-right')!

    // All at same Y
    expect(left.position.y).toBe(center.position.y)
    expect(center.position.y).toBe(right.position.y)

    // X order: endpoint (left or right) < center (middle has 2 peer connections)
    // The BFS starts from an endpoint, so we just verify the middle is not at the extremes
    const xs = [left.position.x, center.position.x, right.position.x].sort((a, b) => a - b)
    expect(center.position.x).toBe(xs[1]) // pve-center must be in the middle
  })

  it('keeps child nodes (parentId set) in place', () => {
    const nodes = [
      makeNode('router', 'router'),
      makeNode('pve1', 'proxmox'),
      makeNode('vm1', 'vm', 'pve1'),
    ]
    const edges = [makeEdge('router', 'pve1')]

    const result = applyDagreLayout(nodes, edges)
    const vm1 = result.find((n) => n.id === 'vm1')!
    expect(vm1.position).toEqual({ x: 0, y: 0 })
  })

  it('places a node below its parent when the edge exits from the top handle (upward edge)', () => {
    // Frigate connects UP to Proxmox via its top handle (source=Frigate, sourceHandle='top')
    // Dagre must place Frigate BELOW Proxmox, not above.
    const nodes = [
      makeNode('router', 'router'),
      makeNode('proxmox', 'proxmox'),
      makeNode('frigate', 'server'),
    ]
    const edges = [
      makeEdge('router', 'proxmox'),
      makeEdge('frigate', 'proxmox', 'top'), // upward edge: frigate → proxmox via top handle
    ]

    const result = applyDagreLayout(nodes, edges)
    const proxmox = result.find((n) => n.id === 'proxmox')!
    const frigate = result.find((n) => n.id === 'frigate')!

    expect(frigate.position.y).toBeGreaterThan(proxmox.position.y)
  })

  it('orders children left-to-right by the parent bottom-port, not node order', () => {
    // Nodes inserted in REVERSE port order — Dagre would otherwise lay them out
    // c,b,a (it orders siblings by node-insertion order). The port pass must
    // flip them back to a,b,c to match the host's ports 1,2,3.
    const nodes = [
      makeNode('host', 'router'),
      makeNode('c', 'generic'),
      makeNode('b', 'generic'),
      makeNode('a', 'generic'),
    ]
    const edges = [
      makeEdge('host', 'a', 'bottom'),
      makeEdge('host', 'b', 'bottom-2'),
      makeEdge('host', 'c', 'bottom-3'),
    ]

    const result = applyDagreLayout(nodes, edges)
    const x = (id: string) => result.find((n) => n.id === id)!.position.x

    expect(x('a')).toBeLessThan(x('b'))
    expect(x('b')).toBeLessThan(x('c'))
  })

  it('shifts a reordered child subtree along with the child', () => {
    // b plugs into port 1 (left of a on port 2). b/a each have a leaf child;
    // the leaves must follow their parent's new horizontal position.
    const nodes = [
      makeNode('host', 'router'),
      makeNode('a', 'generic'),
      makeNode('b', 'generic'),
      makeNode('a2', 'generic'),
      makeNode('b2', 'generic'),
    ]
    const edges = [
      makeEdge('host', 'a', 'bottom-2'),
      makeEdge('host', 'b', 'bottom'),
      makeEdge('a', 'a2', 'bottom'),
      makeEdge('b', 'b2', 'bottom'),
    ]

    const result = applyDagreLayout(nodes, edges)
    const x = (id: string) => result.find((n) => n.id === id)!.position.x

    // b (port 1) sits left of a (port 2), and each leaf follows its parent.
    expect(x('b')).toBeLessThan(x('a'))
    expect(x('b2')).toBeLessThan(x('a2'))
  })

  it('places two switch nodes connected to each other at the same Y', () => {
    const nodes = [
      makeNode('router', 'router'),
      makeNode('sw1', 'switch'),
      makeNode('sw2', 'switch'),
    ]
    const edges = [
      makeEdge('router', 'sw1'),
      makeEdge('router', 'sw2'),
      makeEdge('sw1', 'sw2'),
    ]

    const result = applyDagreLayout(nodes, edges)
    const sw1 = result.find((n) => n.id === 'sw1')!
    const sw2 = result.find((n) => n.id === 'sw2')!
    expect(sw1.position.y).toBe(sw2.position.y)
  })
})

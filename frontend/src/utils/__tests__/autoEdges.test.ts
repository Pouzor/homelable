import { describe, it, expect } from 'vitest'
import { applyAutoEdges, handleSide, type AutoEdge } from '../autoEdges'
import type { Edge, Node } from '@xyflow/react'
import type { EdgeData, NodeData } from '@/types'

function node(id: string, data: Partial<NodeData> = {}): Node<NodeData> {
  return {
    id,
    position: { x: 0, y: 0 },
    data: { label: id, type: 'proxmox', status: 'online', services: [], ...data },
  }
}

describe('handleSide', () => {
  it('maps handle ids (with -t / slot suffixes) to their side', () => {
    expect(handleSide('left-t')).toBe('left')
    expect(handleSide('right')).toBe('right')
    expect(handleSide('bottom-2')).toBe('bottom')
    expect(handleSide('top')).toBe('top')
    expect(handleSide(null)).toBeNull()
  })
})

describe('applyAutoEdges', () => {
  it('injects a cluster edge with its handles and grants left/right handles', () => {
    const nodes = [node('a'), node('b')]
    const auto: AutoEdge[] = [
      { id: 'e1', source: 'a', target: 'b', type: 'cluster', source_handle: 'right', target_handle: 'left' },
    ]
    const res = applyAutoEdges(nodes, [], auto)

    // Edge keeps its cluster type + right→left handles (not the iot default).
    expect(res.edges).toHaveLength(1)
    expect(res.edges[0]).toMatchObject({ type: 'cluster', sourceHandle: 'right', targetHandle: 'left' })
    // Source node gained a right handle; target node gained a left handle.
    expect(res.nodes.find((n) => n.id === 'a')!.data.right_handles).toBe(1)
    expect(res.nodes.find((n) => n.id === 'b')!.data.left_handles).toBe(1)
  })

  it('does not lower an existing higher handle count', () => {
    const nodes = [node('a', { right_handles: 3 }), node('b')]
    const auto: AutoEdge[] = [
      { id: 'e1', source: 'a', target: 'b', type: 'cluster', source_handle: 'right', target_handle: 'left' },
    ]
    const res = applyAutoEdges(nodes, [], auto)
    expect(res.nodes.find((n) => n.id === 'a')!.data.right_handles).toBe(3)
  })

  it('defaults to an iot bottom→top edge and bumps no handles', () => {
    const nodes = [node('a'), node('b')]
    const auto: AutoEdge[] = [{ id: 'e1', source: 'a', target: 'b' }]
    const res = applyAutoEdges(nodes, [], auto)
    expect(res.edges[0]).toMatchObject({ type: 'iot', sourceHandle: 'bottom', targetHandle: 'top' })
    // top/bottom always exist — nodes are returned untouched.
    expect(res.nodes).toBe(nodes)
  })

  it('appends to existing edges rather than replacing them', () => {
    const existing = [{ id: 'x', source: 'a', target: 'b' }] as Edge<EdgeData>[]
    const res = applyAutoEdges([node('a'), node('b')], existing, [
      { id: 'e1', source: 'a', target: 'b', type: 'iot' },
    ])
    expect(res.edges.map((e) => e.id)).toEqual(['x', 'e1'])
  })
})

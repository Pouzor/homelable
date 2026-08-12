import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { Node } from '@xyflow/react'
import type { NodeData } from '@/types'
import { useAlignmentGuides } from '../useAlignmentGuides'

const nodesRef: { current: Node<NodeData>[] } = { current: [] }
const setNodes = vi.fn()

vi.mock('@xyflow/react', async () => (await import('@/test/mocks')).mockReactFlow({
  useReactFlow: () => ({
    getNodes: () => nodesRef.current,
    setNodes,
  }),
}))

function makeFlowNode(
  id: string,
  x: number,
  y: number,
  over: Partial<Node<NodeData>> = {},
): Node<NodeData> {
  return {
    id,
    type: 'custom',
    position: { x, y },
    data: { label: id, type: 'server' } as NodeData,
    measured: { width: 100, height: 50 },
    ...over,
  }
}

const evt = {} as MouseEvent

describe('useAlignmentGuides — parented nodes', () => {
  beforeEach(() => {
    localStorage.clear()
    setNodes.mockClear()
    nodesRef.current = []
  })

  it('emits guides for a node dragged inside a group (parent-relative coords)', () => {
    // Group at (500, 500); two children in parent-relative coordinates.
    // Child "b" sits 3px off "a" horizontally → within the default threshold.
    nodesRef.current = [
      makeFlowNode('group', 500, 500, { type: 'group', measured: { width: 400, height: 400 } }),
      makeFlowNode('a', 20, 20, { parentId: 'group' }),
      makeFlowNode('b', 23, 200, { parentId: 'group' }),
    ]
    const { result } = renderHook(() => useAlignmentGuides())

    act(() => {
      result.current.onNodeDrag(evt, nodesRef.current[2], [nodesRef.current[2]])
    })

    // Guides are in absolute canvas space: group.x + a.x = 520.
    const xGuides = result.current.guides.filter((g) => g.axis === 'x')
    expect(xGuides.length).toBeGreaterThan(0)
    expect(xGuides.map((g) => g.position)).toContain(520)
  })

  it('snaps the dragged child on drag stop, keeping its parent-relative position', () => {
    nodesRef.current = [
      makeFlowNode('group', 500, 500, { type: 'group', measured: { width: 400, height: 400 } }),
      makeFlowNode('a', 20, 20, { parentId: 'group' }),
      makeFlowNode('b', 23, 200, { parentId: 'group' }),
    ]
    const { result } = renderHook(() => useAlignmentGuides())

    act(() => {
      result.current.onNodeDrag(evt, nodesRef.current[2], [nodesRef.current[2]])
      result.current.onNodeDragStop(evt, nodesRef.current[2], [nodesRef.current[2]])
    })

    expect(setNodes).toHaveBeenCalledTimes(1)
    const updated = setNodes.mock.calls[0][0](nodesRef.current) as Node<NodeData>[]
    // -3 applied to the relative position: 23 → 20, absolute 523 → 520.
    expect(updated.find((n) => n.id === 'b')!.position.x).toBe(20)
    expect(updated.find((n) => n.id === 'a')!.position.x).toBe(20)
  })

  it('aligns a child against a top-level node outside its group', () => {
    nodesRef.current = [
      makeFlowNode('group', 500, 500, { type: 'group', measured: { width: 400, height: 400 } }),
      makeFlowNode('outside', 520, 50),
      makeFlowNode('child', 24, 100, { parentId: 'group' }),
    ]
    const { result } = renderHook(() => useAlignmentGuides())

    act(() => {
      result.current.onNodeDrag(evt, nodesRef.current[2], [nodesRef.current[2]])
    })

    expect(result.current.guides.some((g) => g.axis === 'x' && g.position === 520)).toBe(true)
  })

  it('resolves nested container chains (container in a group)', () => {
    nodesRef.current = [
      makeFlowNode('group', 100, 100, { type: 'group', measured: { width: 600, height: 600 } }),
      makeFlowNode('host', 50, 50, { parentId: 'group', measured: { width: 300, height: 300 } }),
      makeFlowNode('vm1', 10, 10, { parentId: 'host' }),
      makeFlowNode('vm2', 14, 120, { parentId: 'host' }),
    ]
    const { result } = renderHook(() => useAlignmentGuides())

    act(() => {
      result.current.onNodeDrag(evt, nodesRef.current[3], [nodesRef.current[3]])
    })

    // vm1 absolute x = 100 + 50 + 10 = 160.
    expect(result.current.guides.some((g) => g.axis === 'x' && g.position === 160)).toBe(true)
  })

  it('does not snap a child whose parent is dragged too (no double shift)', () => {
    nodesRef.current = [
      makeFlowNode('group', 497, 500, { type: 'group', measured: { width: 400, height: 400 } }),
      makeFlowNode('child', 23, 20, { parentId: 'group' }),
      makeFlowNode('other', 500, 1200),
    ]
    const { result } = renderHook(() => useAlignmentGuides())
    const dragged = [nodesRef.current[0], nodesRef.current[1]]

    act(() => {
      result.current.onNodeDrag(evt, dragged[0], dragged)
      result.current.onNodeDragStop(evt, dragged[0], dragged)
    })

    const updated = setNodes.mock.calls[0][0](nodesRef.current) as Node<NodeData>[]
    // The group snaps by +3; the child follows it, so its relative x is untouched.
    expect(updated.find((n) => n.id === 'group')!.position.x).toBe(500)
    expect(updated.find((n) => n.id === 'child')!.position.x).toBe(23)
  })

  it('ignores nodes that follow the drag as alignment candidates', () => {
    // Only the group is dragged; its child must not act as a candidate for itself.
    nodesRef.current = [
      makeFlowNode('group', 500, 500, { type: 'group', measured: { width: 400, height: 400 } }),
      makeFlowNode('child', 2, 20, { parentId: 'group' }),
    ]
    const { result } = renderHook(() => useAlignmentGuides())

    act(() => {
      result.current.onNodeDrag(evt, nodesRef.current[0], [nodesRef.current[0]])
    })

    expect(result.current.guides).toHaveLength(0)
  })
})

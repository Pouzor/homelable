import { describe, it, expect, beforeEach } from 'vitest'
import { useCanvasStore } from '@/stores/canvasStore'
import type { NodeChange, Node } from '@xyflow/react'
import type { NodeData } from '@/types'
import { makeNode, makeEdge } from '@/test/factories'

function resetStore() {
  useCanvasStore.setState({
    nodes: [],
    edges: [],
    hasUnsavedChanges: false,
    selectedNodeId: null,
    selectedNodeIds: [],
    editingGroupRectId: null,
    editingTextId: null,
    past: [],
    future: [],
    clipboard: { nodes: [], edges: [] },
    serviceStatuses: {},
    floorMap: null,
  })
}

/** A `position` NodeChange as React Flow emits during/after a drag. */
function posChange(id: string, x: number, y: number): NodeChange<Node<NodeData>> {
  return { type: 'position', id, position: { x, y }, dragging: false }
}

describe('canvasStore — edge waypoints follow dragged nodes (#279)', () => {
  beforeEach(resetStore)

  it('translates waypoints by the delta when a connected node is dragged', () => {
    useCanvasStore.setState({
      nodes: [makeNode('a', {}), makeNode('b', {})],
      edges: [makeEdge('e1', 'a', 'b', { data: { type: 'ethernet', waypoints: [{ x: 100, y: 100 }, { x: 150, y: 120 }] } })],
    })
    // node 'a' starts at (0,0), dragged to (40,-10) → delta (40,-10)
    useCanvasStore.getState().onNodesChange([posChange('a', 40, -10)])

    const wps = useCanvasStore.getState().edges[0].data!.waypoints
    expect(wps).toEqual([{ x: 140, y: 90 }, { x: 190, y: 110 }])
  })

  it('leaves waypoints untouched when an unrelated node is dragged', () => {
    useCanvasStore.setState({
      nodes: [makeNode('a', {}), makeNode('b', {}), makeNode('c', {})],
      edges: [makeEdge('e1', 'a', 'b', { data: { type: 'ethernet', waypoints: [{ x: 100, y: 100 }] } })],
    })
    useCanvasStore.getState().onNodesChange([posChange('c', 40, 40)])

    expect(useCanvasStore.getState().edges[0].data!.waypoints).toEqual([{ x: 100, y: 100 }])
  })

  it('translates waypoints of edges between children when their container is dragged', () => {
    // Children are parent-relative; their stored position does NOT change when
    // the container moves, so the fix must propagate the container delta down.
    useCanvasStore.setState({
      nodes: [
        makeNode({ id: 'box', type: 'group', position: { x: 0, y: 0 }, data: { label: 'box', type: 'lxc', container_mode: true } }),
        makeNode({ id: 'a', position: { x: 20, y: 20 }, parentId: 'box' }),
        makeNode({ id: 'b', position: { x: 80, y: 60 }, parentId: 'box' }),
      ],
      edges: [makeEdge('e1', 'a', 'b', { data: { type: 'ethernet', waypoints: [{ x: 200, y: 200 }] } })],
    })
    // Drag the container from (0,0) to (30,15) → delta (30,15)
    useCanvasStore.getState().onNodesChange([posChange('box', 30, 15)])

    expect(useCanvasStore.getState().edges[0].data!.waypoints).toEqual([{ x: 230, y: 215 }])
  })

  it('translates once (not doubled) when both endpoints move by the same delta', () => {
    // A container drag reports the container moving; both children ride along.
    useCanvasStore.setState({
      nodes: [
        makeNode({ id: 'box', type: 'group', position: { x: 0, y: 0 }, data: { label: 'box', type: 'lxc', container_mode: true } }),
        makeNode({ id: 'a', position: { x: 20, y: 20 }, parentId: 'box' }),
        makeNode({ id: 'b', position: { x: 80, y: 60 }, parentId: 'box' }),
      ],
      edges: [makeEdge('e1', 'a', 'b', { data: { type: 'ethernet', waypoints: [{ x: 100, y: 100 }] } })],
    })
    useCanvasStore.getState().onNodesChange([posChange('box', 10, 10)])

    // +10 once, not +20
    expect(useCanvasStore.getState().edges[0].data!.waypoints).toEqual([{ x: 110, y: 110 }])
  })

  it('does not alter edges without waypoints', () => {
    useCanvasStore.setState({
      nodes: [makeNode('a', {}), makeNode('b', {})],
      edges: [makeEdge('e1', 'a', 'b')],
    })
    const before = useCanvasStore.getState().edges[0]
    useCanvasStore.getState().onNodesChange([posChange('a', 40, 40)])
    expect(useCanvasStore.getState().edges[0]).toBe(before)
  })

  it('ignores select-only changes (no movement)', () => {
    useCanvasStore.setState({
      nodes: [makeNode('a', {}), makeNode('b', {})],
      edges: [makeEdge('e1', 'a', 'b', { data: { type: 'ethernet', waypoints: [{ x: 100, y: 100 }] } })],
    })
    useCanvasStore.getState().onNodesChange([{ type: 'select', id: 'a', selected: true }])
    expect(useCanvasStore.getState().edges[0].data!.waypoints).toEqual([{ x: 100, y: 100 }])
  })
})

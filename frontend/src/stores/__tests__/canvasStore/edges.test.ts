import { describe, it, expect, beforeEach } from 'vitest'
import { useCanvasStore } from '@/stores/canvasStore'
import type { Node } from '@xyflow/react'
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

describe('canvasStore — edges', () => {
  beforeEach(() => {
    resetStore()
  })

  it('onEdgesChange marks unsaved for remove changes', () => {
    useCanvasStore.setState((s) => ({ edges: [...s.edges, makeEdge('e1', 'n1', 'n2')] }))
    useCanvasStore.getState().markSaved()
    useCanvasStore.getState().onEdgesChange([{ type: 'remove', id: 'e1' }])
    expect(useCanvasStore.getState().hasUnsavedChanges).toBe(true)
  })

  it('onEdgesChange does not mark unsaved for select-only changes', () => {
    useCanvasStore.setState((s) => ({ edges: [...s.edges, makeEdge('e1', 'n1', 'n2')] }))
    useCanvasStore.getState().markSaved()
    useCanvasStore.getState().onEdgesChange([{ type: 'select', id: 'e1', selected: true }])
    expect(useCanvasStore.getState().hasUnsavedChanges).toBe(false)
  })

  it('onConnect adds an edge between two nodes', () => {
    useCanvasStore.getState().onConnect({ source: 'n1', target: 'n2', sourceHandle: null, targetHandle: null })
    const { edges, hasUnsavedChanges } = useCanvasStore.getState()
    expect(edges).toHaveLength(1)
    expect(edges[0].source).toBe('n1')
    expect(edges[0].target).toBe('n2')
    expect(hasUnsavedChanges).toBe(true)
  })

  it('onConnect preserves type and label from edge data', () => {
    const conn = Object.assign({ source: 'n1', target: 'n2', sourceHandle: null, targetHandle: null }, { type: 'wifi', label: 'uplink' })
    useCanvasStore.getState().onConnect(conn)
    const { edges } = useCanvasStore.getState()
    expect(edges[0].type).toBe('wifi')
    expect(edges[0].data?.type).toBe('wifi')
    expect(edges[0].data?.label).toBe('uplink')
  })

  it('onConnect preserves animated from edge data', () => {
    const conn = Object.assign({ source: 'n1', target: 'n2', sourceHandle: null, targetHandle: null }, { type: 'ethernet', animated: 'snake' })
    useCanvasStore.getState().onConnect(conn)
    const { edges } = useCanvasStore.getState()
    expect(edges[0].data?.animated).toBe('snake')
  })

  it('onConnect allows multiple edges between the same two nodes (no dedupe)', () => {
    // Regression: React Flow addEdge() dropped a second edge between the same
    // source+target when handles were null/equal. A homelab has multiple links
    // between two devices, so every connect must add an edge.
    useCanvasStore.getState().onConnect({ source: 'n1', target: 'n2', sourceHandle: null, targetHandle: null })
    useCanvasStore.getState().onConnect({ source: 'n1', target: 'n2', sourceHandle: null, targetHandle: null })
    const { edges } = useCanvasStore.getState()
    expect(edges).toHaveLength(2)
    expect(edges[0].id).not.toBe(edges[1].id)
  })

  it('onConnect preserves endpoint marker shapes from edge data', () => {
    const conn = Object.assign({ source: 'n1', target: 'n2', sourceHandle: null, targetHandle: null }, { type: 'ethernet', marker_start: 'diamond', marker_end: 'arrow' })
    useCanvasStore.getState().onConnect(conn)
    const { edges } = useCanvasStore.getState()
    expect(edges[0].data?.marker_start).toBe('diamond')
    expect(edges[0].data?.marker_end).toBe('arrow')
  })

  it('onConnect preserves sourceHandle and targetHandle for cluster edges', () => {
    const conn = Object.assign({ source: 'n1', target: 'n2', sourceHandle: 'cluster-right', targetHandle: 'cluster-left' }, { type: 'cluster' })
    useCanvasStore.getState().onConnect(conn)
    const { edges } = useCanvasStore.getState()
    expect(edges).toHaveLength(1)
    expect(edges[0].sourceHandle).toBe('cluster-right')
    expect(edges[0].targetHandle).toBe('cluster-left')
    expect(edges[0].type).toBe('cluster')
  })

  it('updateEdge updates edge data and marks unsaved', () => {
    useCanvasStore.setState((s) => ({ edges: [...s.edges, makeEdge('e1', 'n1', 'n2')] }))
    useCanvasStore.getState().markSaved()
    useCanvasStore.getState().updateEdge('e1', { type: 'wifi', label: 'uplink' })
    const edge = useCanvasStore.getState().edges.find((e) => e.id === 'e1')
    expect(edge?.data?.type).toBe('wifi')
    expect(edge?.data?.label).toBe('uplink')
    expect(useCanvasStore.getState().hasUnsavedChanges).toBe(true)
  })

  it('reconnectEdge swaps source/target and normalizes handles', () => {
    useCanvasStore.setState((s) => ({
      edges: [...s.edges, { ...makeEdge('e1', 'n1', 'n2'), sourceHandle: 'bottom', targetHandle: 'top' }],
    }))
    useCanvasStore.getState().markSaved()
    useCanvasStore.getState().reconnectEdge('e1', {
      source: 'n1',
      target: 'n3',
      sourceHandle: 'bottom-2-t',
      targetHandle: 'top-t',
    })
    const edge = useCanvasStore.getState().edges.find((e) => e.id === 'e1')
    expect(edge?.target).toBe('n3')
    expect(edge?.source).toBe('n1')
    expect(edge?.sourceHandle).toBe('bottom-2')
    expect(edge?.targetHandle).toBe('top')
    expect(useCanvasStore.getState().hasUnsavedChanges).toBe(true)
  })

  it('deleteEdge removes the edge and marks unsaved', () => {
    useCanvasStore.setState((s) => ({ edges: [...s.edges, makeEdge('e1', 'n1', 'n2'), makeEdge('e2', 'n2', 'n3')] }))
    useCanvasStore.getState().markSaved()
    useCanvasStore.getState().deleteEdge('e1')
    const { edges, hasUnsavedChanges } = useCanvasStore.getState()
    expect(edges.find((e) => e.id === 'e1')).toBeUndefined()
    expect(edges.find((e) => e.id === 'e2')).toBeDefined()
    expect(hasUnsavedChanges).toBe(true)
  })

  it('setProxmoxContainerMode ON nests children inside proxmox', () => {
    const proxmox: Node<NodeData> = { id: 'px', type: 'proxmox', position: { x: 0, y: 0 }, data: { label: 'px', type: 'proxmox', status: 'unknown', services: [], container_mode: false } }
    const child = makeNode('vm1', { parent_id: 'px', type: 'vm' })
    useCanvasStore.setState({ nodes: [proxmox, child] })
    useCanvasStore.getState().setProxmoxContainerMode('px', true)
    const { nodes } = useCanvasStore.getState()
    const updatedProxy = nodes.find((n) => n.id === 'px')
    const updatedChild = nodes.find((n) => n.id === 'vm1')
    expect(updatedProxy?.data.container_mode).toBe(true)
    expect(updatedProxy?.width).toBe(300)
    expect(updatedChild?.parentId).toBe('px')
    expect(updatedChild?.extent).toBe('parent')
  })

  // ── bottom_handles edge remapping ──────────────────────────────────────────

  it('remaps source edges to "bottom" when bottom_handles is reduced', () => {
    const node = makeNode('n1', { bottom_handles: 4 })
    const edge = { ...makeEdge('e1', 'n1', 'n2'), sourceHandle: 'bottom-3' }
    useCanvasStore.setState({ nodes: [node, makeNode('n2')], edges: [edge] })

    useCanvasStore.getState().updateNode('n1', { bottom_handles: 2 })

    const updated = useCanvasStore.getState().edges.find((e) => e.id === 'e1')
    expect(updated?.sourceHandle).toBe('bottom')
  })

  it('remaps target edges to "bottom" when bottom_handles is reduced', () => {
    const node = makeNode('n2', { bottom_handles: 3 })
    const edge = { ...makeEdge('e1', 'n1', 'n2'), targetHandle: 'bottom-3' }
    useCanvasStore.setState({ nodes: [makeNode('n1'), node], edges: [edge] })

    useCanvasStore.getState().updateNode('n2', { bottom_handles: 1 })

    const updated = useCanvasStore.getState().edges.find((e) => e.id === 'e1')
    expect(updated?.targetHandle).toBe('bottom')
  })

  it('does not remap edges that are on handles still present after reduction', () => {
    const node = makeNode('n1', { bottom_handles: 4 })
    const edge = { ...makeEdge('e1', 'n1', 'n2'), sourceHandle: 'bottom-2' }
    useCanvasStore.setState({ nodes: [node, makeNode('n2')], edges: [edge] })

    useCanvasStore.getState().updateNode('n1', { bottom_handles: 3 })

    const updated = useCanvasStore.getState().edges.find((e) => e.id === 'e1')
    expect(updated?.sourceHandle).toBe('bottom-2')
  })

  it('does not remap edges when bottom_handles increases', () => {
    const node = makeNode('n1', { bottom_handles: 2 })
    const edge = { ...makeEdge('e1', 'n1', 'n2'), sourceHandle: 'bottom' }
    useCanvasStore.setState({ nodes: [node, makeNode('n2')], edges: [edge] })

    useCanvasStore.getState().updateNode('n1', { bottom_handles: 4 })

    const updated = useCanvasStore.getState().edges.find((e) => e.id === 'e1')
    expect(updated?.sourceHandle).toBe('bottom')
  })

  it('never remaps the "bottom" handle itself', () => {
    const node = makeNode('n1', { bottom_handles: 4 })
    const edge = { ...makeEdge('e1', 'n1', 'n2'), sourceHandle: 'bottom' }
    useCanvasStore.setState({ nodes: [node, makeNode('n2')], edges: [edge] })

    useCanvasStore.getState().updateNode('n1', { bottom_handles: 1 })

    const updated = useCanvasStore.getState().edges.find((e) => e.id === 'e1')
    expect(updated?.sourceHandle).toBe('bottom')
  })

  // Regression: handle cap raised from 4 to 48 — remap must scale.
  it('remaps high-count handles when shrinking from 12 to 2', () => {
    const node = makeNode('n1', { bottom_handles: 12 })
    const edges = [
      { ...makeEdge('e2', 'n1', 'n2'), sourceHandle: 'bottom-2' },
      { ...makeEdge('e3', 'n1', 'n2'), sourceHandle: 'bottom-5' },
      { ...makeEdge('e12', 'n1', 'n2'), sourceHandle: 'bottom-12' },
    ]
    useCanvasStore.setState({ nodes: [node, makeNode('n2')], edges })

    useCanvasStore.getState().updateNode('n1', { bottom_handles: 2 })

    const after = useCanvasStore.getState().edges
    expect(after.find((e) => e.id === 'e2')?.sourceHandle).toBe('bottom-2')
    expect(after.find((e) => e.id === 'e3')?.sourceHandle).toBe('bottom')
    expect(after.find((e) => e.id === 'e12')?.sourceHandle).toBe('bottom')
  })

  // ── per-side edge remapping (issue #243) ──────────────────────────────────

  it('remaps top edges to "top" slot 0 when top_handles is reduced', () => {
    const node = makeNode('n1', { top_handles: 3 })
    const edge = { ...makeEdge('e1', 'n1', 'n2'), sourceHandle: 'top-3' }
    useCanvasStore.setState({ nodes: [node, makeNode('n2')], edges: [edge] })

    useCanvasStore.getState().updateNode('n1', { top_handles: 1 })

    expect(useCanvasStore.getState().edges.find((e) => e.id === 'e1')?.sourceHandle).toBe('top')
  })

  it('remaps left/right edges to "bottom" when the side drops to 0 (slot 0 gone)', () => {
    const node = makeNode('n1', { left_handles: 2, right_handles: 2 })
    const edges = [
      { ...makeEdge('e1', 'n1', 'n2'), sourceHandle: 'left' },
      { ...makeEdge('e2', 'n1', 'n2'), sourceHandle: 'left-2' },
      { ...makeEdge('e3', 'n1', 'n2'), targetHandle: 'right', source: 'n2', target: 'n1' },
    ]
    useCanvasStore.setState({ nodes: [node, makeNode('n2')], edges })

    useCanvasStore.getState().updateNode('n1', { left_handles: 0, right_handles: 0 })

    const after = useCanvasStore.getState().edges
    expect(after.find((e) => e.id === 'e1')?.sourceHandle).toBe('bottom')
    expect(after.find((e) => e.id === 'e2')?.sourceHandle).toBe('bottom')
    expect(after.find((e) => e.id === 'e3')?.targetHandle).toBe('bottom')
  })

  it('remaps a side to its own slot 0 when shrinking but not to 0', () => {
    const node = makeNode('n1', { right_handles: 3 })
    const edge = { ...makeEdge('e1', 'n1', 'n2'), sourceHandle: 'right-3' }
    useCanvasStore.setState({ nodes: [node, makeNode('n2')], edges: [edge] })

    useCanvasStore.getState().updateNode('n1', { right_handles: 1 })

    expect(useCanvasStore.getState().edges.find((e) => e.id === 'e1')?.sourceHandle).toBe('right')
  })

  it('leaves edges on other sides untouched when one side shrinks', () => {
    const node = makeNode('n1', { top_handles: 3, bottom_handles: 3 })
    const edges = [
      { ...makeEdge('e1', 'n1', 'n2'), sourceHandle: 'bottom-3' },
      { ...makeEdge('e2', 'n1', 'n2'), sourceHandle: 'top-2' },
    ]
    useCanvasStore.setState({ nodes: [node, makeNode('n2')], edges })

    useCanvasStore.getState().updateNode('n1', { bottom_handles: 1 })

    const after = useCanvasStore.getState().edges
    expect(after.find((e) => e.id === 'e1')?.sourceHandle).toBe('bottom')
    expect(after.find((e) => e.id === 'e2')?.sourceHandle).toBe('top-2')
  })
})

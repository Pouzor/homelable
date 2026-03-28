import { describe, it, expect, beforeEach } from 'vitest'
import { useCanvasStore } from '@/stores/canvasStore'
import type { Node, Edge } from '@xyflow/react'
import type { NodeData, EdgeData } from '@/types'

const makeNode = (id: string, overrides: Partial<NodeData> = {}): Node<NodeData> => ({
  id,
  type: 'server',
  position: { x: 0, y: 0 },
  data: { label: id, type: 'server', status: 'unknown', services: [], ...overrides },
})

const makeEdge = (id: string, source: string, target: string): Edge<EdgeData> => ({
  id,
  source,
  target,
  type: 'ethernet',
  data: { type: 'ethernet' },
})

describe('canvasStore', () => {
  beforeEach(() => {
    useCanvasStore.setState({
      nodes: [],
      edges: [],
      hasUnsavedChanges: false,
      selectedNodeId: null,
      editingGroupRectId: null,
      past: [],
      future: [],
      clipboard: [],
    })
  })

  it('starts empty', () => {
    const { nodes, edges, hasUnsavedChanges } = useCanvasStore.getState()
    expect(nodes).toHaveLength(0)
    expect(edges).toHaveLength(0)
    expect(hasUnsavedChanges).toBe(false)
  })

  it('addNode adds a node and marks unsaved', () => {
    const { addNode } = useCanvasStore.getState()
    addNode(makeNode('n1'))
    const { nodes, hasUnsavedChanges } = useCanvasStore.getState()
    expect(nodes).toHaveLength(1)
    expect(nodes[0].id).toBe('n1')
    expect(hasUnsavedChanges).toBe(true)
  })

  it('updateNode updates data fields', () => {
    useCanvasStore.getState().addNode(makeNode('n1', { label: 'old' }))
    useCanvasStore.getState().updateNode('n1', { label: 'new', ip: '10.0.0.1' })
    const node = useCanvasStore.getState().nodes.find((n) => n.id === 'n1')
    expect(node?.data.label).toBe('new')
    expect(node?.data.ip).toBe('10.0.0.1')
  })

  it('deleteNode removes node and its connected edges', () => {
    const store = useCanvasStore.getState()
    store.addNode(makeNode('n1'))
    store.addNode(makeNode('n2'))
    useCanvasStore.setState((s) => ({ edges: [...s.edges, makeEdge('e1', 'n1', 'n2')] }))
    useCanvasStore.getState().deleteNode('n1')
    const { nodes, edges } = useCanvasStore.getState()
    expect(nodes.find((n) => n.id === 'n1')).toBeUndefined()
    expect(edges.find((e) => e.id === 'e1')).toBeUndefined()
  })

  it('deleteNode clears selectedNodeId if it was the deleted node', () => {
    useCanvasStore.getState().addNode(makeNode('n1'))
    useCanvasStore.getState().setSelectedNode('n1')
    expect(useCanvasStore.getState().selectedNodeId).toBe('n1')
    useCanvasStore.getState().deleteNode('n1')
    expect(useCanvasStore.getState().selectedNodeId).toBeNull()
  })

  it('markSaved clears hasUnsavedChanges', () => {
    useCanvasStore.getState().addNode(makeNode('n1'))
    expect(useCanvasStore.getState().hasUnsavedChanges).toBe(true)
    useCanvasStore.getState().markSaved()
    expect(useCanvasStore.getState().hasUnsavedChanges).toBe(false)
  })

  it('loadCanvas replaces state', () => {
    useCanvasStore.getState().addNode(makeNode('old'))
    useCanvasStore.getState().loadCanvas([makeNode('n1'), makeNode('n2')], [makeEdge('e1', 'n1', 'n2')])
    const { nodes, edges, hasUnsavedChanges } = useCanvasStore.getState()
    expect(nodes).toHaveLength(2)
    expect(edges).toHaveLength(1)
    expect(hasUnsavedChanges).toBe(false)
  })

  it('setSelectedNode sets and clears selection', () => {
    useCanvasStore.getState().setSelectedNode('n1')
    expect(useCanvasStore.getState().selectedNodeId).toBe('n1')
    useCanvasStore.getState().setSelectedNode(null)
    expect(useCanvasStore.getState().selectedNodeId).toBeNull()
  })

  it('onNodesChange marks unsaved', () => {
    useCanvasStore.getState().addNode(makeNode('n1'))
    useCanvasStore.getState().markSaved()
    useCanvasStore.getState().onNodesChange([{ type: 'select', id: 'n1', selected: true }])
    expect(useCanvasStore.getState().hasUnsavedChanges).toBe(true)
  })

  it('onEdgesChange marks unsaved', () => {
    useCanvasStore.setState((s) => ({ edges: [...s.edges, makeEdge('e1', 'n1', 'n2')] }))
    useCanvasStore.getState().markSaved()
    useCanvasStore.getState().onEdgesChange([{ type: 'select', id: 'e1', selected: true }])
    expect(useCanvasStore.getState().hasUnsavedChanges).toBe(true)
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

  it('onConnect preserves sourceHandle and targetHandle for cluster edges', () => {
    const conn = Object.assign({ source: 'n1', target: 'n2', sourceHandle: 'cluster-right', targetHandle: 'cluster-left' }, { type: 'cluster' })
    useCanvasStore.getState().onConnect(conn)
    const { edges } = useCanvasStore.getState()
    expect(edges).toHaveLength(1)
    expect(edges[0].sourceHandle).toBe('cluster-right')
    expect(edges[0].targetHandle).toBe('cluster-left')
    expect(edges[0].type).toBe('cluster')
  })

  it('addNode with parent_id sets parentId and extent', () => {
    useCanvasStore.getState().addNode(makeNode('parent'))
    useCanvasStore.getState().addNode(makeNode('child', { parent_id: 'parent' }))
    const child = useCanvasStore.getState().nodes.find((n) => n.id === 'child')
    expect(child?.parentId).toBe('parent')
    expect(child?.extent).toBe('parent')
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

  it('setProxmoxContainerMode OFF detaches children', () => {
    const proxmox: Node<NodeData> = { id: 'px', type: 'proxmox', position: { x: 0, y: 0 }, data: { label: 'px', type: 'proxmox', status: 'unknown', services: [], container_mode: true }, parentId: undefined }
    const child: Node<NodeData> = { id: 'vm1', type: 'vm', position: { x: 0, y: 0 }, data: { label: 'vm1', type: 'vm', status: 'unknown', services: [], parent_id: 'px' }, parentId: 'px', extent: 'parent' }
    useCanvasStore.setState({ nodes: [proxmox, child] })
    useCanvasStore.getState().setProxmoxContainerMode('px', false)
    const { nodes } = useCanvasStore.getState()
    const updatedChild = nodes.find((n) => n.id === 'vm1')
    expect(nodes.find((n) => n.id === 'px')?.data.container_mode).toBe(false)
    expect(updatedChild?.parentId).toBeUndefined()
    expect(updatedChild?.extent).toBeUndefined()
  })

  it('setEditingGroupRectId sets and clears the editing id', () => {
    useCanvasStore.getState().setEditingGroupRectId('rect-1')
    expect(useCanvasStore.getState().editingGroupRectId).toBe('rect-1')
    useCanvasStore.getState().setEditingGroupRectId(null)
    expect(useCanvasStore.getState().editingGroupRectId).toBeNull()
  })

  it('setNodeZIndex updates the node zIndex and marks unsaved', () => {
    useCanvasStore.getState().addNode(makeNode('n1'))
    useCanvasStore.getState().markSaved()
    useCanvasStore.getState().setNodeZIndex('n1', -5)
    const node = useCanvasStore.getState().nodes.find((n) => n.id === 'n1')
    expect(node?.zIndex).toBe(-5)
    expect(useCanvasStore.getState().hasUnsavedChanges).toBe(true)
  })

  it('addNode with groupRect type preserves zIndex and dimensions', () => {
    const rectNode: Node<NodeData> = {
      id: 'rect-1',
      type: 'groupRect',
      position: { x: 100, y: 100 },
      data: { label: 'Zone A', type: 'groupRect', status: 'unknown', services: [] },
      width: 360,
      height: 240,
      zIndex: -9,
    }
    useCanvasStore.getState().addNode(rectNode)
    const stored = useCanvasStore.getState().nodes.find((n) => n.id === 'rect-1')
    expect(stored?.type).toBe('groupRect')
    expect(stored?.zIndex).toBe(-9)
    expect(stored?.width).toBe(360)
    expect(stored?.height).toBe(240)
  })

  it('loadCanvas sorts parents before children', () => {
    const parent = makeNode('p1')
    const child: Node<NodeData> = { ...makeNode('c1', { parent_id: 'p1' }), parentId: 'p1', extent: 'parent' }
    useCanvasStore.getState().loadCanvas([child, parent], [])
    const { nodes } = useCanvasStore.getState()
    const parentIdx = nodes.findIndex((n) => n.id === 'p1')
    const childIdx = nodes.findIndex((n) => n.id === 'c1')
    expect(parentIdx).toBeLessThan(childIdx)
  })

  // --- History (undo/redo) ---

  it('snapshotHistory pushes current state to past and clears future', () => {
    const { addNode, snapshotHistory } = useCanvasStore.getState()
    addNode(makeNode('n1'))
    snapshotHistory()
    const { past, future } = useCanvasStore.getState()
    expect(past).toHaveLength(1)
    expect(past[0].nodes).toHaveLength(1)
    expect(future).toHaveLength(0)
  })

  it('undo restores previous state and moves current to future', () => {
    const { addNode, snapshotHistory, undo } = useCanvasStore.getState()
    addNode(makeNode('n1'))
    snapshotHistory()
    addNode(makeNode('n2'))
    undo()
    const { nodes, past, future } = useCanvasStore.getState()
    expect(nodes).toHaveLength(1)
    expect(nodes[0].id).toBe('n1')
    expect(past).toHaveLength(0)
    expect(future).toHaveLength(1)
  })

  it('redo re-applies undone state', () => {
    const { addNode, snapshotHistory, undo, redo } = useCanvasStore.getState()
    addNode(makeNode('n1'))
    snapshotHistory()
    addNode(makeNode('n2'))
    undo()
    redo()
    const { nodes, future } = useCanvasStore.getState()
    expect(nodes).toHaveLength(2)
    expect(future).toHaveLength(0)
  })

  it('undo does nothing when past is empty', () => {
    const { addNode, undo } = useCanvasStore.getState()
    addNode(makeNode('n1'))
    undo()
    expect(useCanvasStore.getState().nodes).toHaveLength(1)
  })

  it('snapshotHistory clears future (new branch)', () => {
    const { addNode, snapshotHistory, undo } = useCanvasStore.getState()
    addNode(makeNode('n1'))
    snapshotHistory()
    addNode(makeNode('n2'))
    undo()
    // now take a new action
    snapshotHistory()
    addNode(makeNode('n3'))
    expect(useCanvasStore.getState().future).toHaveLength(0)
  })

  // --- Clipboard (copy/paste) ---

  it('copySelectedNodes stores only selected nodes', () => {
    useCanvasStore.setState({
      nodes: [
        { ...makeNode('a'), selected: true },
        { ...makeNode('b'), selected: false },
      ],
      edges: [],
    })
    useCanvasStore.getState().copySelectedNodes()
    const { clipboard } = useCanvasStore.getState()
    expect(clipboard).toHaveLength(1)
    expect(clipboard[0].id).toBe('a')
  })

  it('pasteNodes creates new nodes with new IDs and offset position', () => {
    const node = { ...makeNode('src'), position: { x: 100, y: 100 }, selected: true }
    useCanvasStore.setState({ nodes: [node], edges: [], clipboard: [node] })
    useCanvasStore.getState().pasteNodes()
    const { nodes } = useCanvasStore.getState()
    expect(nodes).toHaveLength(2)
    const pasted = nodes.find((n) => n.id !== 'src')!
    expect(pasted).toBeDefined()
    expect(pasted.position.x).toBe(150)
    expect(pasted.position.y).toBe(150)
    expect(pasted.selected).toBe(false)
  })

  it('pasteNodes does nothing when clipboard is empty', () => {
    useCanvasStore.setState({ nodes: [makeNode('n1')], edges: [], clipboard: [] })
    useCanvasStore.getState().pasteNodes()
    expect(useCanvasStore.getState().nodes).toHaveLength(1)
  })

  // --- Node resizing (width / height) ---

  it('addNode preserves explicit width and height', () => {
    const node: Node<NodeData> = { ...makeNode('n1'), width: 280, height: 120 }
    useCanvasStore.getState().addNode(node)
    const stored = useCanvasStore.getState().nodes.find((n) => n.id === 'n1')
    expect(stored?.width).toBe(280)
    expect(stored?.height).toBe(120)
  })

  it('onNodesChange dimensions change updates width and height', () => {
    useCanvasStore.getState().addNode(makeNode('n1'))
    useCanvasStore.getState().markSaved()
    useCanvasStore.getState().onNodesChange([
      { type: 'dimensions', id: 'n1', dimensions: { width: 320, height: 180 }, resizing: true },
    ])
    const node = useCanvasStore.getState().nodes.find((n) => n.id === 'n1')
    expect(node?.measured?.width ?? node?.width).toBeDefined()
    expect(useCanvasStore.getState().hasUnsavedChanges).toBe(true)
  })

  it('loadCanvas preserves width and height on resized nodes', () => {
    const resized: Node<NodeData> = { ...makeNode('n1'), width: 300, height: 160 }
    useCanvasStore.getState().loadCanvas([resized], [])
    const stored = useCanvasStore.getState().nodes.find((n) => n.id === 'n1')
    expect(stored?.width).toBe(300)
    expect(stored?.height).toBe(160)
  })

  it('loadCanvas preserves undefined width/height for default-sized nodes', () => {
    useCanvasStore.getState().loadCanvas([makeNode('n1')], [])
    const stored = useCanvasStore.getState().nodes.find((n) => n.id === 'n1')
    expect(stored?.width).toBeUndefined()
    expect(stored?.height).toBeUndefined()
  })
})

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
      selectedNodeIds: [],
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

  it('addNode nests under parent only when parent is in container mode', () => {
    const parent = { ...makeNode('p1', { container_mode: false }), position: { x: 100, y: 100 } }
    const child = { ...makeNode('c1', { parent_id: 'p1' }), position: { x: 150, y: 180 } }
    useCanvasStore.getState().addNode(parent)
    useCanvasStore.getState().addNode(child)
    const childNode = useCanvasStore.getState().nodes.find((n) => n.id === 'c1')
    expect(childNode?.parentId).toBeUndefined()

    useCanvasStore.getState().updateNode('p1', { container_mode: true })
    useCanvasStore.getState().setProxmoxContainerMode('p1', true)
    const nested = useCanvasStore.getState().nodes.find((n) => n.id === 'c1')
    expect(nested?.parentId).toBe('p1')
    expect(nested?.extent).toBe('parent')
  })

  it('updateNode updates data fields', () => {
    useCanvasStore.getState().addNode(makeNode('n1', { label: 'old' }))
    useCanvasStore.getState().updateNode('n1', { label: 'new', ip: '10.0.0.1' })
    const node = useCanvasStore.getState().nodes.find((n) => n.id === 'n1')
    expect(node?.data.label).toBe('new')
    expect(node?.data.ip).toBe('10.0.0.1')
  })

  it('updateNode setting parent_id on container-mode proxmox sets parentId and relative position', () => {
    const proxmox = { ...makeNode('px1', { type: 'proxmox', container_mode: true }), position: { x: 100, y: 100 } }
    const lxc = { ...makeNode('lxc1', { type: 'lxc' }), position: { x: 160, y: 180 } }
    useCanvasStore.getState().addNode(proxmox)
    useCanvasStore.getState().addNode(lxc)
    useCanvasStore.getState().updateNode('lxc1', { parent_id: 'px1' })
    const node = useCanvasStore.getState().nodes.find((n) => n.id === 'lxc1')
    expect(node?.parentId).toBe('px1')
    expect(node?.extent).toBe('parent')
    // Position should be relative to parent (160-100=60, 180-100=80)
    expect(node?.position.x).toBe(60)
    expect(node?.position.y).toBe(80)
  })

  it('updateNode setting parent_id on non-container proxmox does NOT set React Flow parentId', () => {
    const proxmox = { ...makeNode('px1', { type: 'proxmox', container_mode: false }), position: { x: 100, y: 100 } }
    const lxc = { ...makeNode('lxc1', { type: 'lxc' }), position: { x: 160, y: 180 } }
    useCanvasStore.getState().addNode(proxmox)
    useCanvasStore.getState().addNode(lxc)
    useCanvasStore.getState().updateNode('lxc1', { parent_id: 'px1' })
    const node = useCanvasStore.getState().nodes.find((n) => n.id === 'lxc1')
    expect(node?.parentId).toBeUndefined()
    expect(node?.extent).toBeUndefined()
  })

  it('updateNode clearing parent_id converts position to absolute and clears parentId', () => {
    const proxmox = { ...makeNode('px1', { type: 'proxmox', container_mode: true }), position: { x: 100, y: 100 } }
    const lxc = { ...makeNode('lxc1', { type: 'lxc', parent_id: 'px1' }), position: { x: 130, y: 140 }, parentId: 'px1', extent: 'parent' as const }
    useCanvasStore.getState().addNode(proxmox)
    useCanvasStore.getState().addNode(lxc)
    useCanvasStore.getState().updateNode('lxc1', { parent_id: undefined })
    const node = useCanvasStore.getState().nodes.find((n) => n.id === 'lxc1')
    expect(node?.parentId).toBeUndefined()
    expect(node?.extent).toBeUndefined()
    // Position should be absolute (100+30=130, 100+40=140)
    expect(node?.position.x).toBe(130)
    expect(node?.position.y).toBe(140)
  })

  it('updateNode with parent_id puts parents before children in array', () => {
    const proxmox = { ...makeNode('px1', { type: 'proxmox', container_mode: true }), position: { x: 0, y: 0 } }
    const lxc = { ...makeNode('lxc1', { type: 'lxc' }), position: { x: 10, y: 10 } }
    useCanvasStore.getState().addNode(proxmox)
    useCanvasStore.getState().addNode(lxc)
    useCanvasStore.getState().updateNode('lxc1', { parent_id: 'px1' })
    const { nodes } = useCanvasStore.getState()
    const pxIdx = nodes.findIndex((n) => n.id === 'px1')
    const lxcIdx = nodes.findIndex((n) => n.id === 'lxc1')
    expect(pxIdx).toBeLessThan(lxcIdx)
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

  it('onNodesChange marks unsaved for position changes', () => {
    useCanvasStore.getState().addNode(makeNode('n1'))
    useCanvasStore.getState().markSaved()
    useCanvasStore.getState().onNodesChange([{ type: 'position', id: 'n1', dragging: false }])
    expect(useCanvasStore.getState().hasUnsavedChanges).toBe(true)
  })

  it('onNodesChange does not mark unsaved for select-only changes', () => {
    useCanvasStore.getState().addNode(makeNode('n1'))
    useCanvasStore.getState().markSaved()
    useCanvasStore.getState().onNodesChange([{ type: 'select', id: 'n1', selected: true }])
    expect(useCanvasStore.getState().hasUnsavedChanges).toBe(false)
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

  it('onConnect preserves sourceHandle and targetHandle for cluster edges', () => {
    const conn = Object.assign({ source: 'n1', target: 'n2', sourceHandle: 'cluster-right', targetHandle: 'cluster-left' }, { type: 'cluster' })
    useCanvasStore.getState().onConnect(conn)
    const { edges } = useCanvasStore.getState()
    expect(edges).toHaveLength(1)
    expect(edges[0].sourceHandle).toBe('cluster-right')
    expect(edges[0].targetHandle).toBe('cluster-left')
    expect(edges[0].type).toBe('cluster')
  })

  it('deleteNode also removes children with matching parentId', () => {
    useCanvasStore.getState().addNode(makeNode('parent', { container_mode: true }))
    useCanvasStore.getState().addNode(makeNode('child', { parent_id: 'parent' }))
    useCanvasStore.getState().deleteNode('parent')
    const { nodes } = useCanvasStore.getState()
    expect(nodes.find((n) => n.id === 'parent')).toBeUndefined()
    expect(nodes.find((n) => n.id === 'child')).toBeUndefined()
  })

  it('addNode with parent_id sets parentId and extent', () => {
    useCanvasStore.getState().addNode(makeNode('parent', { container_mode: true }))
    useCanvasStore.getState().addNode(makeNode('child', { parent_id: 'parent' }))
    const child = useCanvasStore.getState().nodes.find((n) => n.id === 'child')
    expect(child?.parentId).toBe('parent')
    expect(child?.extent).toBe('parent')
  })

  // ── selectedNodeIds ───────────────────────────────────────────────────────

  it('selectedNodeIds starts empty', () => {
    expect(useCanvasStore.getState().selectedNodeIds).toEqual([])
  })

  it('onNodesChange syncs selectedNodeIds from select changes', () => {
    useCanvasStore.getState().addNode(makeNode('n1'))
    useCanvasStore.getState().addNode(makeNode('n2'))
    useCanvasStore.getState().onNodesChange([
      { type: 'select', id: 'n1', selected: true },
      { type: 'select', id: 'n2', selected: true },
    ])
    expect(useCanvasStore.getState().selectedNodeIds).toEqual(expect.arrayContaining(['n1', 'n2']))
    expect(useCanvasStore.getState().selectedNodeIds).toHaveLength(2)
  })

  it('setSelectedNode(null) resets selectedNodeIds to empty', () => {
    useCanvasStore.setState({ selectedNodeIds: ['n1', 'n2'] })
    useCanvasStore.getState().setSelectedNode(null)
    expect(useCanvasStore.getState().selectedNodeIds).toEqual([])
  })

  it('setSelectedNode(id) sets selectedNodeIds to [id], clearing multi-selection', () => {
    useCanvasStore.setState({ selectedNodeIds: ['n1', 'n2'] })
    useCanvasStore.getState().setSelectedNode('n1')
    // Single node click resets multi-selection to just the clicked node
    expect(useCanvasStore.getState().selectedNodeIds).toEqual(['n1'])
  })

  // ── createGroup ───────────────────────────────────────────────────────────

  it('createGroup creates a group node at the bounding box of selected nodes', () => {
    // n1 at (100,100), n2 at (300,200); both default to 200x80
    const n1 = { ...makeNode('n1'), position: { x: 100, y: 100 }, width: 200, height: 80 }
    const n2 = { ...makeNode('n2'), position: { x: 300, y: 200 }, width: 200, height: 80 }
    useCanvasStore.setState({ nodes: [n1, n2] })

    useCanvasStore.getState().createGroup(['n1', 'n2'], 'My Group')

    const { nodes } = useCanvasStore.getState()
    const group = nodes.find((n) => n.data.type === 'group')
    expect(group).toBeDefined()
    expect(group?.data.label).toBe('My Group')
    // groupX = 100-24=76, groupY = 100-48=52
    expect(group?.position.x).toBe(76)
    expect(group?.position.y).toBe(52)
    // groupW = (500-100)+48=448, groupH = (280-100)+48+24=252
    expect(group?.width).toBe(448)
    expect(group?.height).toBe(252)
  })

  it('createGroup converts children to relative positions', () => {
    const n1 = { ...makeNode('n1'), position: { x: 100, y: 100 }, width: 200, height: 80 }
    const n2 = { ...makeNode('n2'), position: { x: 300, y: 200 }, width: 200, height: 80 }
    useCanvasStore.setState({ nodes: [n1, n2] })

    useCanvasStore.getState().createGroup(['n1', 'n2'], 'G')

    const { nodes } = useCanvasStore.getState()
    const c1 = nodes.find((n) => n.id === 'n1')
    const c2 = nodes.find((n) => n.id === 'n2')
    // groupX=76, groupY=52 → relative: n1=(24,48), n2=(224,148)
    expect(c1?.position).toEqual({ x: 24, y: 48 })
    expect(c2?.position).toEqual({ x: 224, y: 148 })
  })

  it('createGroup sets parentId and extent on children', () => {
    const n1 = { ...makeNode('n1'), position: { x: 100, y: 100 } }
    const n2 = { ...makeNode('n2'), position: { x: 200, y: 100 } }
    useCanvasStore.setState({ nodes: [n1, n2] })

    useCanvasStore.getState().createGroup(['n1', 'n2'], 'G')

    const { nodes } = useCanvasStore.getState()
    const group = nodes.find((n) => n.data.type === 'group')!
    const c1 = nodes.find((n) => n.id === 'n1')
    const c2 = nodes.find((n) => n.id === 'n2')
    expect(c1?.parentId).toBe(group.id)
    expect(c1?.extent).toBe('parent')
    expect(c2?.parentId).toBe(group.id)
  })

  it('createGroup places the group node before its children in the array', () => {
    const n1 = { ...makeNode('n1'), position: { x: 100, y: 100 } }
    const n2 = { ...makeNode('n2'), position: { x: 200, y: 100 } }
    useCanvasStore.setState({ nodes: [n1, n2] })

    useCanvasStore.getState().createGroup(['n1', 'n2'], 'G')

    const { nodes } = useCanvasStore.getState()
    const groupIdx = nodes.findIndex((n) => n.data.type === 'group')
    const c1Idx = nodes.findIndex((n) => n.id === 'n1')
    const c2Idx = nodes.findIndex((n) => n.id === 'n2')
    expect(groupIdx).toBeLessThan(c1Idx)
    expect(groupIdx).toBeLessThan(c2Idx)
  })

  it('createGroup snapshots history and marks unsaved', () => {
    const n1 = { ...makeNode('n1'), position: { x: 100, y: 100 } }
    useCanvasStore.setState({ nodes: [n1] })
    useCanvasStore.getState().markSaved()

    useCanvasStore.getState().createGroup(['n1'], 'G')

    expect(useCanvasStore.getState().past).toHaveLength(1)
    expect(useCanvasStore.getState().hasUnsavedChanges).toBe(true)
  })

  it('createGroup clears selection', () => {
    const n1 = { ...makeNode('n1'), position: { x: 100, y: 100 } }
    useCanvasStore.setState({ nodes: [n1], selectedNodeId: 'n1', selectedNodeIds: ['n1'] })

    useCanvasStore.getState().createGroup(['n1'], 'G')

    expect(useCanvasStore.getState().selectedNodeId).toBeNull()
    expect(useCanvasStore.getState().selectedNodeIds).toEqual([])
  })

  // ── ungroup ───────────────────────────────────────────────────────────────

  it('ungroup restores children to absolute positions', () => {
    const group = {
      ...makeNode('g1', { type: 'group', label: 'G' }),
      position: { x: 76, y: 52 },
    }
    const c1 = { ...makeNode('n1'), position: { x: 24, y: 48 }, parentId: 'g1', extent: 'parent' as const }
    const c2 = { ...makeNode('n2'), position: { x: 224, y: 148 }, parentId: 'g1', extent: 'parent' as const }
    useCanvasStore.setState({ nodes: [group, c1, c2] })

    useCanvasStore.getState().ungroup('g1')

    const { nodes } = useCanvasStore.getState()
    const r1 = nodes.find((n) => n.id === 'n1')
    const r2 = nodes.find((n) => n.id === 'n2')
    expect(r1?.position).toEqual({ x: 100, y: 100 })
    expect(r2?.position).toEqual({ x: 300, y: 200 })
  })

  it('ungroup removes parentId and extent from children', () => {
    const group = { ...makeNode('g1', { type: 'group', label: 'G' }), position: { x: 0, y: 0 } }
    const child = { ...makeNode('n1'), position: { x: 50, y: 50 }, parentId: 'g1', extent: 'parent' as const }
    useCanvasStore.setState({ nodes: [group, child] })

    useCanvasStore.getState().ungroup('g1')

    const { nodes } = useCanvasStore.getState()
    const released = nodes.find((n) => n.id === 'n1')
    expect(released?.parentId).toBeUndefined()
    expect(released?.extent).toBeUndefined()
  })

  it('ungroup deletes the group node', () => {
    const group = { ...makeNode('g1', { type: 'group', label: 'G' }), position: { x: 0, y: 0 } }
    useCanvasStore.setState({ nodes: [group] })

    useCanvasStore.getState().ungroup('g1')

    expect(useCanvasStore.getState().nodes.find((n) => n.id === 'g1')).toBeUndefined()
  })

  it('ungroup snapshots history and marks unsaved', () => {
    const group = { ...makeNode('g1', { type: 'group', label: 'G' }), position: { x: 0, y: 0 } }
    useCanvasStore.setState({ nodes: [group] })
    useCanvasStore.getState().markSaved()

    useCanvasStore.getState().ungroup('g1')

    expect(useCanvasStore.getState().past).toHaveLength(1)
    expect(useCanvasStore.getState().hasUnsavedChanges).toBe(true)
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
})

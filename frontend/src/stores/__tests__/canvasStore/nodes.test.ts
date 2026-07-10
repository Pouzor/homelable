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

describe('canvasStore — nodes', () => {
  beforeEach(() => {
    resetStore()
  })

  it('setServiceStatuses stores live status keyed by node/port/protocol', () => {
    const { setServiceStatuses } = useCanvasStore.getState()
    setServiceStatuses('node-1', [
      { port: 80, protocol: 'tcp', status: 'offline' },
      { port: 443, protocol: 'tcp', status: 'online' },
    ])
    const { serviceStatuses } = useCanvasStore.getState()
    expect(serviceStatuses['node-1:80/tcp']).toBe('offline')
    expect(serviceStatuses['node-1:443/tcp']).toBe('online')
  })

  it('setServiceStatuses merges without dropping other nodes', () => {
    const { setServiceStatuses } = useCanvasStore.getState()
    setServiceStatuses('node-1', [{ port: 80, protocol: 'tcp', status: 'online' }])
    setServiceStatuses('node-2', [{ port: 22, protocol: 'tcp', status: 'offline' }])
    const { serviceStatuses } = useCanvasStore.getState()
    expect(serviceStatuses['node-1:80/tcp']).toBe('online')
    expect(serviceStatuses['node-2:22/tcp']).toBe('offline')
  })

  it('does not mark canvas unsaved on a service status update', () => {
    useCanvasStore.setState({ hasUnsavedChanges: false })
    useCanvasStore.getState().setServiceStatuses('n', [{ port: 80, protocol: 'tcp', status: 'offline' }])
    expect(useCanvasStore.getState().hasUnsavedChanges).toBe(false)
  })

  it('setEditingTextId sets and clears editing text id', () => {
    const { setEditingTextId } = useCanvasStore.getState()
    setEditingTextId('t1')
    expect(useCanvasStore.getState().editingTextId).toBe('t1')
    setEditingTextId(null)
    expect(useCanvasStore.getState().editingTextId).toBeNull()
  })

  it('addNode supports text type with text_content and style', () => {
    const { addNode } = useCanvasStore.getState()
    const textNode: Node<NodeData> = {
      id: 't1',
      type: 'text',
      position: { x: 50, y: 50 },
      data: {
        label: '',
        type: 'text',
        status: 'unknown',
        services: [],
        text_content: 'Hello world',
        custom_colors: {
          text_color: '#ffffff',
          text_size: 24,
          font: 'mono',
          border_style: 'dashed',
          border_width: 2,
          border: '#00d4ff',
          background: '#00000000',
        },
      },
      width: 200,
      height: 60,
    }
    addNode(textNode)
    const stored = useCanvasStore.getState().nodes.find((n) => n.id === 't1')
    expect(stored?.type).toBe('text')
    expect(stored?.data.text_content).toBe('Hello world')
    expect(stored?.data.custom_colors?.text_size).toBe(24)
    expect(stored?.data.custom_colors?.border_style).toBe('dashed')
  })

  it('updateNode updates text_content and custom_colors on a text node', () => {
    const { addNode, updateNode } = useCanvasStore.getState()
    addNode({ ...makeNode('t1', { type: 'text', text_content: 'old' }), type: 'text' })
    updateNode('t1', { text_content: 'new', custom_colors: { text_color: '#ff0000', text_size: 32 } })
    const stored = useCanvasStore.getState().nodes.find((n) => n.id === 't1')
    expect(stored?.data.text_content).toBe('new')
    expect(stored?.data.custom_colors?.text_color).toBe('#ff0000')
    expect(stored?.data.custom_colors?.text_size).toBe(32)
  })

  it('deleteNode removes a text node', () => {
    const { addNode, deleteNode } = useCanvasStore.getState()
    addNode({ ...makeNode('t1', { type: 'text' }), type: 'text' })
    deleteNode('t1')
    expect(useCanvasStore.getState().nodes).toHaveLength(0)
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

  it('setEditingGroupRectId sets and clears the editing id', () => {
    useCanvasStore.getState().setEditingGroupRectId('rect-1')
    expect(useCanvasStore.getState().editingGroupRectId).toBe('rect-1')
    useCanvasStore.getState().setEditingGroupRectId(null)
    expect(useCanvasStore.getState().editingGroupRectId).toBeNull()
  })

  // --- Hide IP preference (persisted to localStorage) ---

  it('toggleHideIp flips the flag and persists it', () => {
    localStorage.removeItem('homelable.hideIp')
    useCanvasStore.setState({ hideIp: false })
    useCanvasStore.getState().toggleHideIp()
    expect(useCanvasStore.getState().hideIp).toBe(true)
    expect(localStorage.getItem('homelable.hideIp')).toBe('true')
    useCanvasStore.getState().toggleHideIp()
    expect(useCanvasStore.getState().hideIp).toBe(false)
    expect(localStorage.getItem('homelable.hideIp')).toBe('false')
  })

  it('setHideIp sets the flag and persists it', () => {
    localStorage.removeItem('homelable.hideIp')
    useCanvasStore.getState().setHideIp(true)
    expect(useCanvasStore.getState().hideIp).toBe(true)
    expect(localStorage.getItem('homelable.hideIp')).toBe('true')
  })
})

import { describe, it, expect, beforeEach } from 'vitest'
import { useCanvasStore } from '@/stores/canvasStore'
import { makeNode } from '@/test/factories'

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

describe('canvasStore — selection', () => {
  beforeEach(() => {
    resetStore()
  })

  it('setSelectedNode sets and clears selection', () => {
    useCanvasStore.getState().setSelectedNode('n1')
    expect(useCanvasStore.getState().selectedNodeId).toBe('n1')
    useCanvasStore.getState().setSelectedNode(null)
    expect(useCanvasStore.getState().selectedNodeId).toBeNull()
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
})

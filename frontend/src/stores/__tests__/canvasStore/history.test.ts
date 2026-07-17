import { describe, it, expect, beforeEach } from 'vitest'
import { useCanvasStore } from '@/stores/canvasStore'
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

describe('canvasStore — history', () => {
  beforeEach(() => {
    resetStore()
  })

  it('reconnectEdge snapshots history for undo', () => {
    useCanvasStore.setState((s) => ({ edges: [...s.edges, makeEdge('e1', 'n1', 'n2')], past: [] }))
    useCanvasStore.getState().reconnectEdge('e1', { source: 'n1', target: 'n3', sourceHandle: null, targetHandle: null })
    expect(useCanvasStore.getState().past.length).toBe(1)
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

  // --- Auto Layout keeps history so it can be undone (#280) ---

  it('applyLayout snapshots history and can be undone', () => {
    const { addNode, applyLayout, undo } = useCanvasStore.getState()
    addNode(makeNode('n1'))
    const before = useCanvasStore.getState().nodes
    // simulate an auto-layout that moves the node
    applyLayout([{ ...before[0], position: { x: 500, y: 500 } }], [])
    expect(useCanvasStore.getState().nodes[0].position).toEqual({ x: 500, y: 500 })
    expect(useCanvasStore.getState().past).toHaveLength(1)
    undo()
    expect(useCanvasStore.getState().nodes[0].position).toEqual({ x: 0, y: 0 })
  })

  it('applyLayout marks the canvas unsaved and clears future', () => {
    const { addNode, snapshotHistory, undo, applyLayout } = useCanvasStore.getState()
    addNode(makeNode('n1'))
    snapshotHistory()
    addNode(makeNode('n2'))
    undo() // creates a future entry
    expect(useCanvasStore.getState().future).toHaveLength(1)
    applyLayout(useCanvasStore.getState().nodes, [])
    const s = useCanvasStore.getState()
    expect(s.hasUnsavedChanges).toBe(true)
    expect(s.future).toHaveLength(0)
  })
})

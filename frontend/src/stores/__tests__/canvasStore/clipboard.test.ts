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

describe('canvasStore — clipboard', () => {
  beforeEach(() => {
    resetStore()
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
    expect(clipboard.nodes).toHaveLength(1)
    expect(clipboard.nodes[0].id).toBe('a')
  })

  it('copySelectedNodes captures edges whose endpoints are both selected', () => {
    useCanvasStore.setState({
      nodes: [
        { ...makeNode('a'), selected: true },
        { ...makeNode('b'), selected: true },
        { ...makeNode('c'), selected: false },
      ],
      edges: [makeEdge('e-ab', 'a', 'b'), makeEdge('e-bc', 'b', 'c')],
    })
    useCanvasStore.getState().copySelectedNodes()
    const { clipboard } = useCanvasStore.getState()
    expect(clipboard.nodes.map((n) => n.id).sort()).toEqual(['a', 'b'])
    expect(clipboard.edges).toHaveLength(1)
    expect(clipboard.edges[0].id).toBe('e-ab')
  })

  it('copySelectedNodes pulls in children of a selected group', () => {
    useCanvasStore.setState({
      nodes: [
        { ...makeNode('g', { type: 'group' }), type: 'group', selected: true },
        { ...makeNode('child', { parent_id: 'g' }), parentId: 'g', selected: false },
      ],
      edges: [],
    })
    useCanvasStore.getState().copySelectedNodes()
    expect(useCanvasStore.getState().clipboard.nodes.map((n) => n.id).sort()).toEqual(['child', 'g'])
  })

  it('pasteNodes creates new nodes with new IDs and a cascade offset by default', () => {
    const node = { ...makeNode('src'), position: { x: 100, y: 100 } }
    useCanvasStore.setState({ nodes: [], edges: [], clipboard: { nodes: [node], edges: [] } })
    useCanvasStore.getState().pasteNodes()
    const { nodes } = useCanvasStore.getState()
    expect(nodes).toHaveLength(1)
    const pasted = nodes[0]
    expect(pasted.id).not.toBe('src')
    expect(pasted.position).toEqual({ x: 150, y: 150 })
    expect(pasted.selected).toBe(true)
  })

  it('pasteNodes centers the pasted bounding box on the target point', () => {
    const node = { ...makeNode('src'), position: { x: 0, y: 0 }, width: 100, height: 100 }
    useCanvasStore.setState({ nodes: [], edges: [], clipboard: { nodes: [node], edges: [] } })
    useCanvasStore.getState().pasteNodes({ x: 500, y: 300 })
    const pasted = useCanvasStore.getState().nodes[0]
    // bbox center (50,50) shifted onto (500,300) → top-left at (450,250)
    expect(pasted.position).toEqual({ x: 450, y: 250 })
  })

  it('pasteNodes remaps edge endpoints to the new node IDs', () => {
    const a = { ...makeNode('a') }
    const b = { ...makeNode('b') }
    useCanvasStore.setState({
      nodes: [],
      edges: [],
      clipboard: { nodes: [a, b], edges: [makeEdge('e-ab', 'a', 'b')] },
    })
    useCanvasStore.getState().pasteNodes()
    const { nodes, edges } = useCanvasStore.getState()
    expect(edges).toHaveLength(1)
    const ids = nodes.map((n) => n.id)
    expect(ids).toContain(edges[0].source)
    expect(ids).toContain(edges[0].target)
    expect(edges[0].source).not.toBe('a')
    expect(edges[0].id).not.toBe('e-ab')
  })

  it('pasteNodes preserves parent-child relationship under remapped IDs', () => {
    const group = { ...makeNode('g', { type: 'group' }), type: 'group', position: { x: 0, y: 0 } }
    const child = { ...makeNode('child', { parent_id: 'g' }), parentId: 'g', extent: 'parent' as const, position: { x: 20, y: 30 } }
    useCanvasStore.setState({ nodes: [], edges: [], clipboard: { nodes: [group, child], edges: [] } })
    useCanvasStore.getState().pasteNodes()
    const { nodes } = useCanvasStore.getState()
    const newGroup = nodes.find((n) => n.data.type === 'group')!
    const newChild = nodes.find((n) => n.id !== newGroup.id)!
    expect(newChild.parentId).toBe(newGroup.id)
    expect(newChild.data.parent_id).toBe(newGroup.id)
    // Child keeps its parent-relative position (no offset applied to children)
    expect(newChild.position).toEqual({ x: 20, y: 30 })
    // Group (the root) precedes its child in the array
    expect(nodes.findIndex((n) => n.id === newGroup.id)).toBeLessThan(
      nodes.findIndex((n) => n.id === newChild.id),
    )
  })

  it('clipboard survives loadCanvas so nodes can be pasted into another design', () => {
    useCanvasStore.setState({
      nodes: [{ ...makeNode('a'), selected: true }],
      edges: [],
    })
    useCanvasStore.getState().copySelectedNodes()
    // Switch to another design: loadCanvas replaces nodes/edges.
    useCanvasStore.getState().loadCanvas([makeNode('other')], [])
    expect(useCanvasStore.getState().clipboard.nodes).toHaveLength(1)
    useCanvasStore.getState().pasteNodes()
    const ids = useCanvasStore.getState().nodes.map((n) => n.id)
    expect(ids).toContain('other')
    expect(ids).toHaveLength(2)
  })

  it('pasteNodes does nothing when clipboard is empty', () => {
    useCanvasStore.setState({ nodes: [makeNode('n1')], edges: [], clipboard: { nodes: [], edges: [] } })
    useCanvasStore.getState().pasteNodes()
    expect(useCanvasStore.getState().nodes).toHaveLength(1)
  })
})

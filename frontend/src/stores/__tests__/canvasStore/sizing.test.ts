import { describe, it, expect, beforeEach } from 'vitest'
import { useCanvasStore } from '@/stores/canvasStore'
import type { Node } from '@xyflow/react'
import type { NodeData } from '@/types'
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

describe('canvasStore — sizing & z-order', () => {
  beforeEach(() => {
    resetStore()
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

  it('updateNode preserves height for group type when properties change (children must not vanish)', () => {
    const group: Node<NodeData> = {
      id: 'g1',
      type: 'group',
      position: { x: 0, y: 0 },
      width: 360,
      height: 240,
      data: { label: 'Zone', type: 'group', status: 'unknown', services: [] },
    }
    useCanvasStore.setState({ nodes: [group], edges: [] })
    useCanvasStore.getState().updateNode('g1', { properties: [] })
    const stored = useCanvasStore.getState().nodes.find((n) => n.id === 'g1')
    expect(stored?.height).toBe(240)
    expect(stored?.width).toBe(360)
  })

  it('updateNode preserves height for groupRect when properties change', () => {
    const rect: Node<NodeData> = {
      id: 'r1',
      type: 'groupRect',
      position: { x: 0, y: 0 },
      width: 360,
      height: 240,
      data: { label: 'Rect', type: 'groupRect', status: 'unknown', services: [] },
    }
    useCanvasStore.setState({ nodes: [rect], edges: [] })
    useCanvasStore.getState().updateNode('r1', { properties: [] })
    expect(useCanvasStore.getState().nodes.find((n) => n.id === 'r1')?.height).toBe(240)
  })
})

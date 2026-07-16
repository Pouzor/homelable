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

  // Regression (#278): editing any field on a container-mode vm/lxc/docker_host host used to
  // reset its manually-set height to undefined, snapping it back to auto-fit size and
  // scrambling nested children. Only proxmox was excluded. Keep the manual height for every
  // container-mode host type.
  it.each(['vm', 'lxc', 'docker_host'] as const)(
    'updateNode preserves manual height for a container-mode %s when properties change',
    (type) => {
      const host: Node<NodeData> = {
        id: 'h1',
        type,
        position: { x: 0, y: 0 },
        width: 400,
        height: 300,
        data: { label: type, type, status: 'unknown', services: [], container_mode: true },
      }
      useCanvasStore.setState({ nodes: [host], edges: [] })
      useCanvasStore.getState().updateNode('h1', { properties: [], label: 'renamed' })
      expect(useCanvasStore.getState().nodes.find((n) => n.id === 'h1')?.height).toBe(300)
    }
  )

  it('updateNode still resets height for a vm NOT in container mode when properties change', () => {
    const leaf: Node<NodeData> = {
      id: 'v1',
      type: 'vm',
      position: { x: 0, y: 0 },
      width: 200,
      height: 120,
      data: { label: 'vm', type: 'vm', status: 'unknown', services: [], container_mode: false },
    }
    useCanvasStore.setState({ nodes: [leaf], edges: [] })
    useCanvasStore.getState().updateNode('v1', { properties: [] })
    expect(useCanvasStore.getState().nodes.find((n) => n.id === 'v1')?.height).toBeUndefined()
  })

  it('updateNode preserves height for a proxmox host when properties change', () => {
    const px: Node<NodeData> = {
      id: 'px1',
      type: 'proxmox',
      position: { x: 0, y: 0 },
      width: 500,
      height: 350,
      data: { label: 'px', type: 'proxmox', status: 'unknown', services: [], container_mode: true },
    }
    useCanvasStore.setState({ nodes: [px], edges: [] })
    useCanvasStore.getState().updateNode('px1', { properties: [] })
    expect(useCanvasStore.getState().nodes.find((n) => n.id === 'px1')?.height).toBe(350)
  })
})

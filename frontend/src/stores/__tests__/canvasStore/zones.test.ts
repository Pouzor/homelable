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

const zone = (id: string, x = 100, y = 100) => ({
  ...makeNode(id, { type: 'groupRect' }),
  type: 'groupRect',
  position: { x, y },
  width: 400,
  height: 300,
})

describe('canvasStore — zone (groupRect) parenting', () => {
  beforeEach(resetStore)

  it('addToZone parents the node and rebases its position on the zone', () => {
    useCanvasStore.setState({
      nodes: [zone('z1'), { ...makeNode('n1'), position: { x: 160, y: 220 } }],
    })
    useCanvasStore.getState().addToZone('z1', 'n1')

    const child = useCanvasStore.getState().nodes.find((n) => n.id === 'n1')!
    expect(child.parentId).toBe('z1')
    expect(child.data.parent_id).toBe('z1')
    expect(child.position).toEqual({ x: 60, y: 120 })
  })

  it('addToZone does not clamp the child with extent, so it can be dragged out', () => {
    useCanvasStore.setState({ nodes: [zone('z1'), makeNode('n1')] })
    useCanvasStore.getState().addToZone('z1', 'n1')
    expect(useCanvasStore.getState().nodes.find((n) => n.id === 'n1')?.extent).toBeUndefined()
  })

  it('addToZone orders the zone before its child (React Flow requirement)', () => {
    useCanvasStore.setState({ nodes: [makeNode('n1'), zone('z1')] })
    useCanvasStore.getState().addToZone('z1', 'n1')
    const ids = useCanvasStore.getState().nodes.map((n) => n.id)
    expect(ids.indexOf('z1')).toBeLessThan(ids.indexOf('n1'))
  })

  it('addToZone is a no-op when the target is not a zone', () => {
    useCanvasStore.setState({ nodes: [makeNode('g1', { type: 'group' }), makeNode('n1')] })
    useCanvasStore.getState().addToZone('g1', 'n1')
    expect(useCanvasStore.getState().nodes.find((n) => n.id === 'n1')?.parentId).toBeUndefined()
  })

  it('addToZone is a no-op when the node is already in that zone', () => {
    useCanvasStore.setState({ nodes: [zone('z1'), makeNode('n1')] })
    useCanvasStore.getState().addToZone('z1', 'n1')
    const first = useCanvasStore.getState().nodes.find((n) => n.id === 'n1')!
    useCanvasStore.getState().addToZone('z1', 'n1')
    expect(useCanvasStore.getState().nodes.find((n) => n.id === 'n1')).toEqual(first)
  })

  it('removeFromGroup releases a zone child back to absolute coords', () => {
    useCanvasStore.setState({
      nodes: [zone('z1'), { ...makeNode('n1'), position: { x: 160, y: 220 } }],
    })
    useCanvasStore.getState().addToZone('z1', 'n1')
    useCanvasStore.getState().removeFromGroup('z1', 'n1')

    const child = useCanvasStore.getState().nodes.find((n) => n.id === 'n1')!
    expect(child.parentId).toBeUndefined()
    expect(child.data.parent_id).toBeUndefined()
    expect(child.position).toEqual({ x: 160, y: 220 })
  })

  it('deleting a zone releases its children instead of deleting them', () => {
    useCanvasStore.setState({
      nodes: [zone('z1'), { ...makeNode('n1'), position: { x: 160, y: 220 } }],
    })
    useCanvasStore.getState().addToZone('z1', 'n1')
    useCanvasStore.getState().deleteNode('z1')

    const nodes = useCanvasStore.getState().nodes
    expect(nodes.map((n) => n.id)).toEqual(['n1'])
    expect(nodes[0].parentId).toBeUndefined()
    expect(nodes[0].position).toEqual({ x: 160, y: 220 })
  })

  it('deleting a container still cascades to its children', () => {
    useCanvasStore.setState({
      nodes: [
        makeNode('px1', { type: 'proxmox', container_mode: true }),
        { ...makeNode('vm1'), parentId: 'px1' },
      ],
    })
    useCanvasStore.getState().deleteNode('px1')
    expect(useCanvasStore.getState().nodes).toHaveLength(0)
  })

  it('addNode nests a node under a zone without clamping it', () => {
    useCanvasStore.getState().addNode(zone('z1'))
    useCanvasStore.getState().addNode({
      ...makeNode('n1', { parent_id: 'z1' }),
      position: { x: 160, y: 220 },
    })
    const child = useCanvasStore.getState().nodes.find((n) => n.id === 'n1')!
    expect(child.parentId).toBe('z1')
    expect(child.extent).toBeUndefined()
    expect(child.position).toEqual({ x: 60, y: 120 })
  })

  it('updateNode can attach a node to a zone and detach it again', () => {
    useCanvasStore.setState({
      nodes: [zone('z1'), { ...makeNode('n1'), position: { x: 160, y: 220 } }],
    })
    useCanvasStore.getState().updateNode('n1', { parent_id: 'z1' })
    const attached = useCanvasStore.getState().nodes.find((n) => n.id === 'n1')!
    expect(attached.parentId).toBe('z1')
    expect(attached.extent).toBeUndefined()

    useCanvasStore.getState().updateNode('n1', { parent_id: undefined })
    const detached = useCanvasStore.getState().nodes.find((n) => n.id === 'n1')!
    expect(detached.parentId).toBeUndefined()
    expect(detached.position).toEqual({ x: 160, y: 220 })
  })
})

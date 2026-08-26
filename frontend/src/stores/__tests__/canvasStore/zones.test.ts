import { describe, it, expect, beforeEach } from 'vitest'
import { useCanvasStore } from '@/stores/canvasStore'
import { makeNode } from '@/test/factories'
import { serializeNode, deserializeApiNode, type ApiNode } from '@/utils/canvasSerializer'

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

describe('canvasStore — importZoneSubnet', () => {
  beforeEach(resetStore)

  const device = (id: string, ip: string | undefined, over: Partial<ReturnType<typeof makeNode>> = {}) => ({
    ...makeNode(id, { ip }),
    position: { x: 900, y: 900 },
    ...over,
  })

  it('moves every free device in range into the zone and reports the count', () => {
    useCanvasStore.setState({
      nodes: [zone('z1'), device('n1', '192.168.1.10'), device('n2', '192.168.1.11')],
    })

    const moved = useCanvasStore.getState().importZoneSubnet('z1', '192.168.1.0/24')

    expect(moved).toBe(2)
    const nodes = useCanvasStore.getState().nodes
    expect(nodes.find((n) => n.id === 'n1')!.parentId).toBe('z1')
    expect(nodes.find((n) => n.id === 'n2')!.parentId).toBe('z1')
  })

  it('leaves out-of-range and address-less devices on the canvas', () => {
    useCanvasStore.setState({
      nodes: [zone('z1'), device('in', '192.168.1.10'), device('out', '10.0.0.1'), device('bare', undefined)],
    })

    expect(useCanvasStore.getState().importZoneSubnet('z1', '192.168.1.0/24')).toBe(1)
    const nodes = useCanvasStore.getState().nodes
    expect(nodes.find((n) => n.id === 'out')!.parentId).toBeUndefined()
    expect(nodes.find((n) => n.id === 'bare')!.parentId).toBeUndefined()
  })

  it('never steals a node that already has a parent', () => {
    useCanvasStore.setState({
      nodes: [
        zone('z1'),
        zone('z2', 800, 100),
        { ...device('n1', '192.168.1.10'), parentId: 'z2' },
      ],
    })

    expect(useCanvasStore.getState().importZoneSubnet('z1', '192.168.1.0/24')).toBe(0)
    expect(useCanvasStore.getState().nodes.find((n) => n.id === 'n1')!.parentId).toBe('z2')
  })

  it('never swallows another zone, even one carrying an IP', () => {
    useCanvasStore.setState({
      nodes: [zone('z1'), { ...zone('z2', 800, 100), data: { ...zone('z2').data, ip: '192.168.1.9' } }],
    })

    expect(useCanvasStore.getState().importZoneSubnet('z1', '192.168.1.0/24')).toBe(0)
    expect(useCanvasStore.getState().nodes.find((n) => n.id === 'z2')!.parentId).toBeUndefined()
  })

  it('is a no-op for an invalid CIDR, a missing zone and a non-zone target', () => {
    useCanvasStore.setState({ nodes: [zone('z1'), device('n1', '192.168.1.10'), device('plain', '192.168.1.11')] })
    const before = useCanvasStore.getState().nodes

    expect(useCanvasStore.getState().importZoneSubnet('z1', 'nonsense')).toBe(0)
    expect(useCanvasStore.getState().importZoneSubnet('nope', '192.168.1.0/24')).toBe(0)
    expect(useCanvasStore.getState().importZoneSubnet('plain', '192.168.1.0/24')).toBe(0)
    expect(useCanvasStore.getState().nodes).toBe(before)
  })

  it('lays arrivals out on a non-overlapping grid inside the zone', () => {
    useCanvasStore.setState({
      nodes: [zone('z1'), device('n1', '192.168.1.10'), device('n2', '192.168.1.11')],
    })
    useCanvasStore.getState().importZoneSubnet('z1', '192.168.1.0/24')

    const nodes = useCanvasStore.getState().nodes
    const a = nodes.find((n) => n.id === 'n1')!.position
    const b = nodes.find((n) => n.id === 'n2')!.position
    expect(a).not.toEqual(b)
    // Zone-relative and clear of the label band at the top.
    for (const p of [a, b]) {
      expect(p.x).toBeGreaterThanOrEqual(0)
      expect(p.y).toBeGreaterThanOrEqual(40)
    }
  })

  it('packs around the boxes already inside the zone', () => {
    useCanvasStore.setState({
      nodes: [
        zone('z1'),
        { ...device('sitting', '10.0.0.1'), parentId: 'z1', position: { x: 16, y: 40 }, width: 160, height: 90 },
        device('n1', '192.168.1.10'),
      ],
    })
    useCanvasStore.getState().importZoneSubnet('z1', '192.168.1.0/24')

    const placed = useCanvasStore.getState().nodes.find((n) => n.id === 'n1')!.position
    expect(placed).not.toEqual({ x: 16, y: 40 })
  })

  it('grows the zone when the arrivals overflow its height', () => {
    const many = Array.from({ length: 12 }, (_, i) => device(`n${i}`, `192.168.1.${i + 10}`))
    useCanvasStore.setState({ nodes: [zone('z1'), ...many] })

    useCanvasStore.getState().importZoneSubnet('z1', '192.168.1.0/24')

    const z = useCanvasStore.getState().nodes.find((n) => n.id === 'z1')!
    expect(z.height!).toBeGreaterThan(300)

    // The grown height has to survive a save/load round-trip. A zone has no
    // height column, so the serializer stashes it in the custom_colors blob
    // on the way out and hoists it back on the way in.
    const wire = serializeNode(z) as { custom_colors: { height: number } }
    expect(wire.custom_colors.height).toBe(z.height)
    const reloaded = deserializeApiNode(wire as unknown as ApiNode, new Map())
    expect(reloaded.height).toBe(z.height)
  })

  it('keeps the parent ahead of its new children, as React Flow requires', () => {
    useCanvasStore.setState({
      nodes: [device('n1', '192.168.1.10'), zone('z1'), device('n2', '192.168.1.11')],
    })
    useCanvasStore.getState().importZoneSubnet('z1', '192.168.1.0/24')

    const ids = useCanvasStore.getState().nodes.map((n) => n.id)
    expect(ids.indexOf('z1')).toBeLessThan(ids.indexOf('n1'))
    expect(ids.indexOf('z1')).toBeLessThan(ids.indexOf('n2'))
  })

  it('keeps an arrival that is itself a parent ahead of the children it leaves behind', () => {
    // A Proxmox host matches the subnet; its VM does not move, because it
    // already has a parent. The host must still be listed before the VM.
    useCanvasStore.setState({
      nodes: [
        device('proxmox', '192.168.1.10'),
        { ...device('vm1', '10.0.0.1'), parentId: 'proxmox' },
        zone('z1'),
      ],
    })

    expect(useCanvasStore.getState().importZoneSubnet('z1', '192.168.1.0/24')).toBe(1)

    const nodes = useCanvasStore.getState().nodes
    const ids = nodes.map((n) => n.id)
    expect(nodes.find((n) => n.id === 'proxmox')!.parentId).toBe('z1')
    expect(nodes.find((n) => n.id === 'vm1')!.parentId).toBe('proxmox')
    expect(ids.indexOf('z1')).toBeLessThan(ids.indexOf('proxmox'))
    expect(ids.indexOf('proxmox')).toBeLessThan(ids.indexOf('vm1'))
  })

  it('leaves an already-valid order untouched', () => {
    useCanvasStore.setState({
      nodes: [zone('z1'), device('a', '10.0.0.1'), device('b', '10.0.0.2'), device('hit', '192.168.1.10')],
    })
    useCanvasStore.getState().importZoneSubnet('z1', '192.168.1.0/24')

    // Only the matched node moves in the array; the untouched ones keep their
    // relative order.
    const ids = useCanvasStore.getState().nodes.map((n) => n.id)
    expect(ids.indexOf('a')).toBeLessThan(ids.indexOf('b'))
    expect(ids[0]).toBe('z1')
  })

  it('is additive: a second subnet keeps the first import inside', () => {
    useCanvasStore.setState({
      nodes: [zone('z1'), device('n1', '192.168.1.10'), device('n2', '10.0.0.5')],
    })
    useCanvasStore.getState().importZoneSubnet('z1', '192.168.1.0/24')
    useCanvasStore.getState().importZoneSubnet('z1', '10.0.0.0/8')

    const nodes = useCanvasStore.getState().nodes
    expect(nodes.find((n) => n.id === 'n1')!.parentId).toBe('z1')
    expect(nodes.find((n) => n.id === 'n2')!.parentId).toBe('z1')
  })

  it('marks the canvas unsaved and undoes the whole import in one step', () => {
    useCanvasStore.setState({
      nodes: [zone('z1'), device('n1', '192.168.1.10'), device('n2', '192.168.1.11')],
    })
    useCanvasStore.getState().importZoneSubnet('z1', '192.168.1.0/24')
    expect(useCanvasStore.getState().hasUnsavedChanges).toBe(true)

    useCanvasStore.getState().undo()

    const nodes = useCanvasStore.getState().nodes
    expect(nodes.find((n) => n.id === 'n1')!.parentId).toBeUndefined()
    expect(nodes.find((n) => n.id === 'n2')!.parentId).toBeUndefined()
  })
})

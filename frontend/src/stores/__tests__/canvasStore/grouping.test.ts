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

describe('canvasStore — grouping', () => {
  beforeEach(() => {
    resetStore()
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

  // ── addToGroup ──────────────────────────────────────────────────────────────

  it('addToGroup nests a top-level node with parent-relative position', () => {
    const group = { ...makeNode('g1', { type: 'group', label: 'G' }), position: { x: 76, y: 52 }, width: 448, height: 252 }
    const child = { ...makeNode('n1'), position: { x: 300, y: 200 } }
    useCanvasStore.setState({ nodes: [group, child] })

    useCanvasStore.getState().addToGroup('g1', 'n1')

    const moved = useCanvasStore.getState().nodes.find((n) => n.id === 'n1')
    expect(moved?.parentId).toBe('g1')
    expect(moved?.extent).toBe('parent')
    expect(moved?.data.parent_id).toBe('g1')
    // 300-76=224, 200-52=148
    expect(moved?.position).toEqual({ x: 224, y: 148 })
  })

  it('addToGroup places the group before the child in the array', () => {
    const child = { ...makeNode('n1'), position: { x: 300, y: 200 } }
    const group = { ...makeNode('g1', { type: 'group', label: 'G' }), position: { x: 0, y: 0 } }
    // child first to prove reordering
    useCanvasStore.setState({ nodes: [child, group] })

    useCanvasStore.getState().addToGroup('g1', 'n1')

    const { nodes } = useCanvasStore.getState()
    expect(nodes.findIndex((n) => n.id === 'g1')).toBeLessThan(nodes.findIndex((n) => n.id === 'n1'))
  })

  it('addToGroup is a no-op when target is not a group', () => {
    const notGroup = { ...makeNode('s1'), position: { x: 0, y: 0 } }
    const child = { ...makeNode('n1'), position: { x: 50, y: 50 } }
    useCanvasStore.setState({ nodes: [notGroup, child] })
    useCanvasStore.getState().markSaved()

    useCanvasStore.getState().addToGroup('s1', 'n1')

    expect(useCanvasStore.getState().nodes.find((n) => n.id === 'n1')?.parentId).toBeUndefined()
    expect(useCanvasStore.getState().hasUnsavedChanges).toBe(false)
  })

  it('addToGroup is a no-op when child already belongs to the group', () => {
    const group = { ...makeNode('g1', { type: 'group', label: 'G' }), position: { x: 0, y: 0 } }
    const child = { ...makeNode('n1'), position: { x: 50, y: 50 }, parentId: 'g1', extent: 'parent' as const }
    useCanvasStore.setState({ nodes: [group, child] })
    useCanvasStore.getState().markSaved()

    useCanvasStore.getState().addToGroup('g1', 'n1')

    expect(useCanvasStore.getState().hasUnsavedChanges).toBe(false)
  })

  it('addToGroup snapshots history and marks unsaved', () => {
    const group = { ...makeNode('g1', { type: 'group', label: 'G' }), position: { x: 0, y: 0 } }
    const child = { ...makeNode('n1'), position: { x: 50, y: 50 } }
    useCanvasStore.setState({ nodes: [group, child] })
    useCanvasStore.getState().markSaved()

    useCanvasStore.getState().addToGroup('g1', 'n1')

    expect(useCanvasStore.getState().past).toHaveLength(1)
    expect(useCanvasStore.getState().hasUnsavedChanges).toBe(true)
  })

  // ── addToContainer ──────────────────────────────────────────────────────────

  it('addToContainer nests a top-level node under a container_mode node', () => {
    const container = { ...makeNode('px1', { type: 'proxmox', container_mode: true, label: 'PX' }), position: { x: 76, y: 52 }, width: 448, height: 252 }
    const child = { ...makeNode('n1'), position: { x: 300, y: 200 } }
    useCanvasStore.setState({ nodes: [container, child] })

    useCanvasStore.getState().addToContainer('px1', 'n1')

    const moved = useCanvasStore.getState().nodes.find((n) => n.id === 'n1')
    expect(moved?.parentId).toBe('px1')
    expect(moved?.extent).toBe('parent')
    expect(moved?.data.parent_id).toBe('px1')
    // 300-76=224, 200-52=148
    expect(moved?.position).toEqual({ x: 224, y: 148 })
  })

  it('addToContainer works for any container_mode type (docker_host)', () => {
    const host = { ...makeNode('dh1', { type: 'docker_host', container_mode: true }), position: { x: 0, y: 0 } }
    const child = { ...makeNode('n1'), position: { x: 50, y: 50 } }
    useCanvasStore.setState({ nodes: [host, child] })

    useCanvasStore.getState().addToContainer('dh1', 'n1')

    expect(useCanvasStore.getState().nodes.find((n) => n.id === 'n1')?.parentId).toBe('dh1')
  })

  it('addToContainer places the container before the child in the array', () => {
    const child = { ...makeNode('n1'), position: { x: 300, y: 200 } }
    const container = { ...makeNode('px1', { type: 'proxmox', container_mode: true }), position: { x: 0, y: 0 } }
    useCanvasStore.setState({ nodes: [child, container] })

    useCanvasStore.getState().addToContainer('px1', 'n1')

    const { nodes } = useCanvasStore.getState()
    expect(nodes.findIndex((n) => n.id === 'px1')).toBeLessThan(nodes.findIndex((n) => n.id === 'n1'))
  })

  it('addToContainer is a no-op when target is not in container_mode', () => {
    const notContainer = { ...makeNode('px1', { type: 'proxmox', container_mode: false }), position: { x: 0, y: 0 } }
    const child = { ...makeNode('n1'), position: { x: 50, y: 50 } }
    useCanvasStore.setState({ nodes: [notContainer, child] })
    useCanvasStore.getState().markSaved()

    useCanvasStore.getState().addToContainer('px1', 'n1')

    expect(useCanvasStore.getState().nodes.find((n) => n.id === 'n1')?.parentId).toBeUndefined()
    expect(useCanvasStore.getState().hasUnsavedChanges).toBe(false)
  })

  it('addToContainer is a no-op when child already belongs to the container', () => {
    const container = { ...makeNode('px1', { type: 'proxmox', container_mode: true }), position: { x: 0, y: 0 } }
    const child = { ...makeNode('n1'), position: { x: 50, y: 50 }, parentId: 'px1', extent: 'parent' as const }
    useCanvasStore.setState({ nodes: [container, child] })
    useCanvasStore.getState().markSaved()

    useCanvasStore.getState().addToContainer('px1', 'n1')

    expect(useCanvasStore.getState().hasUnsavedChanges).toBe(false)
  })

  it('addToContainer snapshots history and marks unsaved', () => {
    const container = { ...makeNode('px1', { type: 'proxmox', container_mode: true }), position: { x: 0, y: 0 } }
    const child = { ...makeNode('n1'), position: { x: 50, y: 50 } }
    useCanvasStore.setState({ nodes: [container, child] })
    useCanvasStore.getState().markSaved()

    useCanvasStore.getState().addToContainer('px1', 'n1')

    expect(useCanvasStore.getState().past).toHaveLength(1)
    expect(useCanvasStore.getState().hasUnsavedChanges).toBe(true)
  })

  // ── removeFromGroup ─────────────────────────────────────────────────────────

  it('removeFromGroup releases the child to absolute coords and keeps the group', () => {
    const group = { ...makeNode('g1', { type: 'group', label: 'G' }), position: { x: 76, y: 52 } }
    const child = { ...makeNode('n1'), position: { x: 224, y: 148 }, parentId: 'g1', extent: 'parent' as const }
    useCanvasStore.setState({ nodes: [group, child] })

    useCanvasStore.getState().removeFromGroup('g1', 'n1')

    const { nodes } = useCanvasStore.getState()
    const released = nodes.find((n) => n.id === 'n1')
    expect(released?.parentId).toBeUndefined()
    expect(released?.extent).toBeUndefined()
    expect(released?.data.parent_id).toBeUndefined()
    // 224+76=300, 148+52=200
    expect(released?.position).toEqual({ x: 300, y: 200 })
    // group survives
    expect(nodes.find((n) => n.id === 'g1')).toBeDefined()
  })

  it('removeFromGroup is a no-op when child is not in the group', () => {
    const group = { ...makeNode('g1', { type: 'group', label: 'G' }), position: { x: 0, y: 0 } }
    const child = { ...makeNode('n1'), position: { x: 50, y: 50 } }
    useCanvasStore.setState({ nodes: [group, child] })
    useCanvasStore.getState().markSaved()

    useCanvasStore.getState().removeFromGroup('g1', 'n1')

    expect(useCanvasStore.getState().hasUnsavedChanges).toBe(false)
  })

  it('removeFromGroup snapshots history and marks unsaved', () => {
    const group = { ...makeNode('g1', { type: 'group', label: 'G' }), position: { x: 0, y: 0 } }
    const child = { ...makeNode('n1'), position: { x: 50, y: 50 }, parentId: 'g1', extent: 'parent' as const }
    useCanvasStore.setState({ nodes: [group, child] })
    useCanvasStore.getState().markSaved()

    useCanvasStore.getState().removeFromGroup('g1', 'n1')

    expect(useCanvasStore.getState().past).toHaveLength(1)
    expect(useCanvasStore.getState().hasUnsavedChanges).toBe(true)
  })
})

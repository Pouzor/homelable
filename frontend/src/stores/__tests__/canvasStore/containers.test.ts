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

describe('canvasStore — containers & nesting', () => {
  beforeEach(() => {
    resetStore()
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

  it('addNode strips parentId/extent when the parent is not a container', () => {
    // Regression: a stray extent:'parent' on a non-container parent traps the
    // node in the parent's tiny box with no way to drag it out (issue #205).
    const parent = { ...makeNode('p1', { container_mode: false }), position: { x: 100, y: 100 } }
    useCanvasStore.getState().addNode(parent)
    const trapped: Node<NodeData> = {
      ...makeNode('c1', { parent_id: 'p1' }),
      position: { x: 150, y: 180 },
      parentId: 'p1',
      extent: 'parent',
    }
    useCanvasStore.getState().addNode(trapped)
    const child = useCanvasStore.getState().nodes.find((n) => n.id === 'c1')
    expect(child?.parentId).toBeUndefined()
    expect(child?.extent).toBeUndefined()
  })

  it('docker_container nests under docker_host with container_mode on', () => {
    const host = { ...makeNode('dh1', { type: 'docker_host', container_mode: true }), position: { x: 100, y: 100 } }
    const container = { ...makeNode('dc1', { type: 'docker_container' }), position: { x: 160, y: 180 } }
    useCanvasStore.getState().addNode(host)
    useCanvasStore.getState().addNode(container)
    useCanvasStore.getState().updateNode('dc1', { parent_id: 'dh1' })
    const node = useCanvasStore.getState().nodes.find((n) => n.id === 'dc1')
    expect(node?.parentId).toBe('dh1')
    expect(node?.extent).toBe('parent')
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

  it('deleteNode also removes children with matching parentId', () => {
    useCanvasStore.getState().addNode(makeNode('parent', { container_mode: true }))
    useCanvasStore.getState().addNode(makeNode('child', { parent_id: 'parent' }))
    useCanvasStore.getState().deleteNode('parent')
    const { nodes } = useCanvasStore.getState()
    expect(nodes.find((n) => n.id === 'parent')).toBeUndefined()
    expect(nodes.find((n) => n.id === 'child')).toBeUndefined()
  })

  it('addNode with parent_id sets parentId and extent when parent is in container mode', () => {
    useCanvasStore.getState().addNode(makeNode('parent', { container_mode: true }))
    useCanvasStore.getState().addNode(makeNode('child', { parent_id: 'parent' }))
    const child = useCanvasStore.getState().nodes.find((n) => n.id === 'child')
    expect(child?.parentId).toBe('parent')
    expect(child?.extent).toBe('parent')
  })

  it('setProxmoxContainerMode ON sets width/height for docker_host (not just proxmox)', () => {
    const host: Node<NodeData> = { id: 'dh', type: 'docker_host', position: { x: 0, y: 0 }, data: { label: 'dh', type: 'docker_host', status: 'unknown', services: [], container_mode: false } }
    useCanvasStore.setState({ nodes: [host] })
    useCanvasStore.getState().setProxmoxContainerMode('dh', true)
    const updated = useCanvasStore.getState().nodes.find((n) => n.id === 'dh')
    expect(updated?.data.container_mode).toBe(true)
    expect(updated?.width).toBe(300)
    expect(updated?.height).toBe(200)
  })

  it('setProxmoxContainerMode OFF clears width/height for docker_host', () => {
    const host: Node<NodeData> = { id: 'dh', type: 'docker_host', position: { x: 0, y: 0 }, width: 300, height: 200, data: { label: 'dh', type: 'docker_host', status: 'unknown', services: [], container_mode: true } }
    useCanvasStore.setState({ nodes: [host] })
    useCanvasStore.getState().setProxmoxContainerMode('dh', false)
    const updated = useCanvasStore.getState().nodes.find((n) => n.id === 'dh')
    expect(updated?.data.container_mode).toBe(false)
    expect(updated?.width).toBeUndefined()
    expect(updated?.height).toBeUndefined()
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

  it('loadCanvas sorts parents before children', () => {
    const parent = makeNode('p1')
    const child: Node<NodeData> = { ...makeNode('c1', { parent_id: 'p1' }), parentId: 'p1', extent: 'parent' }
    useCanvasStore.getState().loadCanvas([child, parent], [])
    const { nodes } = useCanvasStore.getState()
    const parentIdx = nodes.findIndex((n) => n.id === 'p1')
    const childIdx = nodes.findIndex((n) => n.id === 'c1')
    expect(parentIdx).toBeLessThan(childIdx)
  })
})

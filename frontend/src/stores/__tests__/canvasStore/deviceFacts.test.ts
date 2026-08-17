/**
 * The device-fact baseline: what the canvas was given for each node, so a save
 * can report its own edits instead of pushing a stale snapshot over an edit made
 * meanwhile in the Device Inventory.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useCanvasStore } from '@/stores/canvasStore'
import { changedFactFields } from '@/utils/deviceFacts'
import { makeNode, makeNodeData } from '@/test/factories'

function resetStore() {
  useCanvasStore.setState({
    nodes: [],
    edges: [],
    hasUnsavedChanges: false,
    editSeq: 0,
    selectedNodeId: null,
    selectedNodeIds: [],
    past: [],
    future: [],
    factsBaseline: {},
  })
}

const loadedNode = (id = 'n1', deviceId = 'd-1') =>
  makeNode(id, makeNodeData({ device_id: deviceId, label: 'NAS', ip: '10.0.0.5', notes: 'in the garage' }))

describe('canvasStore — device fact baseline', () => {
  beforeEach(resetStore)

  it('loadCanvas records what the server sent', () => {
    const node = loadedNode()
    useCanvasStore.getState().loadCanvas([node], [])
    const { factsBaseline } = useCanvasStore.getState()
    expect(changedFactFields(node.data, factsBaseline.n1)).toEqual([])
  })

  it('an edited node reports only what it edited', () => {
    useCanvasStore.getState().loadCanvas([loadedNode()], [])
    useCanvasStore.getState().updateNode('n1', { notes: 'moved to the loft' })
    const { nodes, factsBaseline } = useCanvasStore.getState()
    expect(changedFactFields(nodes[0].data, factsBaseline.n1)).toEqual(['notes'])
  })

  it('markSaved rebases, so the next save claims nothing', () => {
    useCanvasStore.getState().loadCanvas([loadedNode()], [])
    useCanvasStore.getState().updateNode('n1', { notes: 'moved to the loft' })
    useCanvasStore.getState().markSaved()
    const { nodes, factsBaseline } = useCanvasStore.getState()
    expect(changedFactFields(nodes[0].data, factsBaseline.n1)).toEqual([])
  })
})

describe('canvasStore — applyDeviceFacts', () => {
  beforeEach(resetStore)

  it('spreads an inventory edit onto every node drawing that device', () => {
    useCanvasStore.getState().loadCanvas([loadedNode('n1'), loadedNode('n2')], [])
    useCanvasStore.getState().applyDeviceFacts('d-1', { notes: 'moved to the loft' })
    expect(useCanvasStore.getState().nodes.map((n) => n.data.notes)).toEqual([
      'moved to the loft',
      'moved to the loft',
    ])
  })

  it('leaves a node drawing another device alone', () => {
    useCanvasStore.getState().loadCanvas([loadedNode('n1', 'd-1'), loadedNode('n2', 'd-2')], [])
    useCanvasStore.getState().applyDeviceFacts('d-1', { notes: 'moved to the loft' })
    expect(useCanvasStore.getState().nodes[1].data.notes).toBe('in the garage')
  })

  it('rebases what it applied, so the canvas does not claim the row edit as its own', () => {
    useCanvasStore.getState().loadCanvas([loadedNode()], [])
    useCanvasStore.getState().applyDeviceFacts('d-1', { notes: 'moved to the loft' })
    const { nodes, factsBaseline } = useCanvasStore.getState()
    expect(changedFactFields(nodes[0].data, factsBaseline.n1)).toEqual([])
  })

  it('is not a canvas edit — the row already holds it', () => {
    useCanvasStore.getState().loadCanvas([loadedNode()], [])
    useCanvasStore.getState().applyDeviceFacts('d-1', { notes: 'moved to the loft' })
    expect(useCanvasStore.getState().hasUnsavedChanges).toBe(false)
    expect(useCanvasStore.getState().editSeq).toBe(0)
  })

  it('keeps a pending canvas edit when the same device changes elsewhere', () => {
    useCanvasStore.getState().loadCanvas([loadedNode()], [])
    useCanvasStore.getState().updateNode('n1', { label: 'Big NAS' })
    // The row carries its own (older) label alongside the edited note.
    useCanvasStore.getState().applyDeviceFacts('d-1', { label: 'NAS', notes: 'moved to the loft' })
    const { nodes, factsBaseline } = useCanvasStore.getState()
    // Unsaved work in progress is not overwritten by the row…
    expect(nodes[0].data.label).toBe('Big NAS')
    expect(nodes[0].data.notes).toBe('moved to the loft')
    // …and is still this canvas' to save. The note is not.
    expect(changedFactFields(nodes[0].data, factsBaseline.n1)).toEqual(['label'])
  })
})

describe('canvasStore — applyDeviceFacts keeps each node\'s arrangement', () => {
  beforeEach(resetStore)

  const ssh = { port: 22, protocol: 'tcp' as const, service_name: 'ssh' }
  const kuma = { port: 3001, protocol: 'tcp' as const, service_name: 'Uptime Kuma' }

  const drawnAs = (id: string, services: typeof ssh[]) =>
    makeNode(id, makeNodeData({ device_id: 'd-1', label: 'NAS', services }))

  it('does not unhide a service the node hid', () => {
    useCanvasStore.getState().loadCanvas([drawnAs('n1', [ssh, { ...kuma, visible: false }])], [])
    // The inventory sends the row's own copy, which carries no such flag.
    useCanvasStore.getState().applyDeviceFacts('d-1', { services: [ssh, kuma] })
    expect(useCanvasStore.getState().nodes[0].data.services).toEqual([
      ssh,
      { ...kuma, visible: false },
    ])
  })

  it('keeps this node\'s order while taking the row\'s values', () => {
    useCanvasStore.getState().loadCanvas([drawnAs('n1', [kuma, ssh])], [])
    useCanvasStore.getState().applyDeviceFacts('d-1', {
      services: [{ ...ssh, path: '/admin' }, kuma],
    })
    expect(useCanvasStore.getState().nodes[0].data.services).toEqual([
      kuma,
      { ...ssh, path: '/admin' },
    ])
  })

  it('brings a service the row gained in hidden', () => {
    useCanvasStore.getState().loadCanvas([drawnAs('n1', [ssh])], [])
    useCanvasStore.getState().applyDeviceFacts('d-1', { services: [ssh, kuma] })
    expect(useCanvasStore.getState().nodes[0].data.services).toEqual([
      ssh,
      { ...kuma, visible: false },
    ])
  })

  it('drops one the row lost', () => {
    useCanvasStore.getState().loadCanvas([drawnAs('n1', [ssh, kuma])], [])
    useCanvasStore.getState().applyDeviceFacts('d-1', { services: [ssh] })
    expect(useCanvasStore.getState().nodes[0].data.services).toEqual([ssh])
  })
})

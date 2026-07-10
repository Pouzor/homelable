import { describe, it, expect, beforeEach } from 'vitest'
import { useCanvasStore } from '@/stores/canvasStore'
import type { Edge } from '@xyflow/react'
import type { EdgeData } from '@/types'
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

describe('canvasStore — custom style apply', () => {
  beforeEach(() => {
    resetStore()
  })

  const serverStyle = {
    borderColor: '#ff0000',
    borderOpacity: 1,
    bgColor: '#111111',
    bgOpacity: 1,
    iconColor: '#ff0000',
    iconOpacity: 1,
    width: 220,
    height: 90,
  }

  it('applyTypeNodeStyle updates matching nodes custom_colors', () => {
    useCanvasStore.setState({
      nodes: [makeNode('n1', { type: 'server' }), makeNode('n2', { type: 'proxmox' })],
      edges: [],
    })
    useCanvasStore.getState().applyTypeNodeStyle('server', serverStyle)

    const n1 = useCanvasStore.getState().nodes.find((n) => n.id === 'n1')!
    const n2 = useCanvasStore.getState().nodes.find((n) => n.id === 'n2')!
    expect(n1.data.custom_colors?.border).toBe('#ff0000')
    expect(n1.width).toBe(220)
    expect(n1.height).toBe(90)
    expect(n2.data.custom_colors?.border).toBeUndefined()
  })

  it('applyTypeNodeStyle with opacity < 1 produces rgba', () => {
    useCanvasStore.setState({ nodes: [makeNode('n1', { type: 'server' })], edges: [] })
    useCanvasStore.getState().applyTypeNodeStyle('server', { ...serverStyle, borderOpacity: 0.5 })

    const n1 = useCanvasStore.getState().nodes.find((n) => n.id === 'n1')!
    expect(n1.data.custom_colors?.border).toMatch(/^rgba\(/)
  })

  it('applyTypeNodeStyle marks canvas unsaved', () => {
    useCanvasStore.setState({ nodes: [makeNode('n1')], edges: [] })
    useCanvasStore.getState().applyTypeNodeStyle('server', serverStyle)
    expect(useCanvasStore.getState().hasUnsavedChanges).toBe(true)
  })

  it('applyTypeEdgeStyle updates matching edges', () => {
    const e1: Edge<EdgeData> = { id: 'e1', source: 'n1', target: 'n2', type: 'ethernet', data: { type: 'ethernet' } }
    const e2: Edge<EdgeData> = { id: 'e2', source: 'n1', target: 'n2', type: 'wifi', data: { type: 'wifi' } }
    useCanvasStore.setState({ nodes: [], edges: [e1, e2] })

    useCanvasStore.getState().applyTypeEdgeStyle('ethernet', { color: '#00ff00', opacity: 1, pathStyle: 'smooth', lineStyle: 'dotted', widthMult: 3, animated: 'flow', arrowStart: 'circle', arrowEnd: 'arrow' })

    const updated1 = useCanvasStore.getState().edges.find((e) => e.id === 'e1')!
    const updated2 = useCanvasStore.getState().edges.find((e) => e.id === 'e2')!
    expect(updated1.data?.custom_color).toBe('#00ff00')
    expect(updated1.data?.path_style).toBe('smooth')
    expect(updated1.data?.line_style).toBe('dotted')
    expect(updated1.data?.width_mult).toBe(3)
    expect(updated1.data?.animated).toBe('flow')
    expect(updated1.data?.marker_start).toBe('circle')
    expect(updated1.data?.marker_end).toBe('arrow')
    expect(updated2.data?.custom_color).toBeUndefined()
    expect(updated2.data?.marker_end).toBeUndefined()
  })

  it('applyAllCustomStyles applies all defined types', () => {
    const proxmoxNode = makeNode('np', { type: 'proxmox' })
    const serverNode = makeNode('ns', { type: 'server' })
    const e1: Edge<EdgeData> = { id: 'e1', source: 'np', target: 'ns', type: 'ethernet', data: { type: 'ethernet' } }
    useCanvasStore.setState({ nodes: [proxmoxNode, serverNode], edges: [e1] })

    useCanvasStore.getState().applyAllCustomStyles({
      nodes: {
        proxmox: { borderColor: '#ff6e00', borderOpacity: 1, bgColor: '#111', bgOpacity: 1, iconColor: '#ff6e00', iconOpacity: 1, width: 0, height: 0 },
      },
      edges: {
        ethernet: { color: '#aabbcc', opacity: 1, pathStyle: 'bezier', lineStyle: 'dashed', widthMult: 2, animated: 'none', arrowStart: 'none', arrowEnd: 'square' },
      },
    })

    const np = useCanvasStore.getState().nodes.find((n) => n.id === 'np')!
    const ns = useCanvasStore.getState().nodes.find((n) => n.id === 'ns')!
    const e = useCanvasStore.getState().edges.find((e) => e.id === 'e1')!
    expect(np.data.custom_colors?.border).toBe('#ff6e00')
    expect(ns.data.custom_colors?.border).toBeUndefined()
    expect(e.data?.custom_color).toBe('#aabbcc')
    expect(e.data?.line_style).toBe('dashed')
    expect(e.data?.width_mult).toBe(2)
    expect(e.data?.marker_end).toBe('square')
    expect(e.data?.marker_start).toBe('none')
    expect(useCanvasStore.getState().hasUnsavedChanges).toBe(true)
  })

  it('setNodeSize sets explicit width/height and marks unsaved', () => {
    useCanvasStore.setState({ nodes: [makeNode('n1')], hasUnsavedChanges: false })
    useCanvasStore.getState().setNodeSize('n1', { width: 220, height: 130 })
    const n = useCanvasStore.getState().nodes.find((x) => x.id === 'n1')!
    expect(n.width).toBe(220)
    expect(n.height).toBe(130)
    expect(useCanvasStore.getState().hasUnsavedChanges).toBe(true)
  })

  it('setNodeSize clamps below the minimum box', () => {
    useCanvasStore.setState({ nodes: [makeNode('n1')] })
    useCanvasStore.getState().setNodeSize('n1', { width: 10, height: 10 })
    const n = useCanvasStore.getState().nodes.find((x) => x.id === 'n1')!
    expect(n.width).toBe(140)
    expect(n.height).toBe(50)
  })

  it('setNodeSize updates only the provided axis', () => {
    useCanvasStore.setState({ nodes: [{ ...makeNode('n1'), width: 200, height: 100 }] })
    useCanvasStore.getState().setNodeSize('n1', { width: 300 })
    const n = useCanvasStore.getState().nodes.find((x) => x.id === 'n1')!
    expect(n.width).toBe(300)
    expect(n.height).toBe(100)
  })
})

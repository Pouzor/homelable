/**
 * Standalone mode save/load tests.
 *
 * In standalone mode (VITE_STANDALONE=true) the canvas is persisted directly
 * to localStorage as JSON — no backend involved. The full RF node object is
 * serialized as-is, which means width/height survive the round-trip without
 * going through serializeNode / deserializeApiNode.
 *
 * These tests verify that critical node properties (especially width/height
 * added for resizable nodes) are not lost through the localStorage cycle, and
 * that the demo data is structurally valid.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import type { Node, Edge } from '@xyflow/react'
import type { NodeData, EdgeData } from '@/types'
import { useCanvasStore } from '@/stores/canvasStore'
import { demoNodes, demoEdges } from '@/utils/demoData'

const STORAGE_KEY = 'homelable_canvas'

// Simulates what App.tsx does on Ctrl+S in standalone mode
function standaloneSerialize(nodes: Node<NodeData>[], edges: Edge<EdgeData>[], theme_id = 'default') {
  return JSON.stringify({ nodes, edges, theme_id })
}

// Simulates what App.tsx does on load in standalone mode
function standaloneDeserialize(raw: string) {
  return JSON.parse(raw) as { nodes: Node<NodeData>[]; edges: Edge<EdgeData>[]; theme_id: string }
}

function makeNode(id: string, overrides: Partial<Node<NodeData>> = {}): Node<NodeData> {
  return {
    id,
    type: 'server',
    position: { x: 0, y: 0 },
    data: { label: id, type: 'server', status: 'unknown', services: [] },
    ...overrides,
  }
}

describe('Standalone localStorage save/load cycle', () => {
  beforeEach(() => {
    localStorage.clear()
    useCanvasStore.setState({ nodes: [], edges: [], hasUnsavedChanges: false })
  })

  // ── width / height round-trip ─────────────────────────────────────────────

  it('preserves width and height for resized nodes', () => {
    const nodes = [makeNode('n1', { width: 320, height: 180 })]
    const raw = standaloneSerialize(nodes, [])
    localStorage.setItem(STORAGE_KEY, raw)

    const { nodes: loaded } = standaloneDeserialize(localStorage.getItem(STORAGE_KEY)!)
    useCanvasStore.getState().loadCanvas(loaded, [])

    const stored = useCanvasStore.getState().nodes.find((n) => n.id === 'n1')
    expect(stored?.width).toBe(320)
    expect(stored?.height).toBe(180)
  })

  it('preserves undefined width/height for default-sized nodes', () => {
    const nodes = [makeNode('n1')]
    const raw = standaloneSerialize(nodes, [])
    const { nodes: loaded } = standaloneDeserialize(raw)
    useCanvasStore.getState().loadCanvas(loaded, [])

    const stored = useCanvasStore.getState().nodes.find((n) => n.id === 'n1')
    expect(stored?.width).toBeUndefined()
    expect(stored?.height).toBeUndefined()
  })

  it('preserves mixed: some nodes resized, others not', () => {
    const nodes = [
      makeNode('n1', { width: 280, height: 120 }),
      makeNode('n2'),
    ]
    const raw = standaloneSerialize(nodes, [])
    const { nodes: loaded } = standaloneDeserialize(raw)
    useCanvasStore.getState().loadCanvas(loaded, [])

    const { nodes: stored } = useCanvasStore.getState()
    expect(stored.find((n) => n.id === 'n1')?.width).toBe(280)
    expect(stored.find((n) => n.id === 'n2')?.width).toBeUndefined()
  })

  // ── other node properties ─────────────────────────────────────────────────

  it('preserves position through the round-trip', () => {
    const nodes = [makeNode('n1', { position: { x: 123, y: 456 } })]
    const raw = standaloneSerialize(nodes, [])
    const { nodes: loaded } = standaloneDeserialize(raw)
    useCanvasStore.getState().loadCanvas(loaded, [])

    expect(useCanvasStore.getState().nodes[0].position).toEqual({ x: 123, y: 456 })
  })

  it('preserves node data fields through the round-trip', () => {
    const nodes = [makeNode('n1', {
      data: {
        label: 'My Router', type: 'router', status: 'online', services: [],
        ip: '192.168.1.1', hostname: 'gw.local',
      },
    })]
    const raw = standaloneSerialize(nodes, [])
    const { nodes: loaded } = standaloneDeserialize(raw)
    useCanvasStore.getState().loadCanvas(loaded, [])

    const stored = useCanvasStore.getState().nodes[0]
    expect(stored.data.label).toBe('My Router')
    expect(stored.data.ip).toBe('192.168.1.1')
    expect(stored.data.hostname).toBe('gw.local')
    expect(stored.data.status).toBe('online')
  })

  it('preserves theme_id through the round-trip', () => {
    const raw = standaloneSerialize([], [], 'cyberpunk')
    const { theme_id } = standaloneDeserialize(raw)
    expect(theme_id).toBe('cyberpunk')
  })

  it('preserves edge data through the round-trip', () => {
    const edges: Edge<EdgeData>[] = [{
      id: 'e1', source: 'n1', target: 'n2', type: 'vlan',
      data: { type: 'vlan', vlan_id: 20, label: 'VLAN 20' },
    }]
    const raw = standaloneSerialize([], edges)
    const { edges: loaded } = standaloneDeserialize(raw)
    useCanvasStore.getState().loadCanvas([], loaded)

    const stored = useCanvasStore.getState().edges[0]
    expect(stored.data?.vlan_id).toBe(20)
    expect(stored.data?.label).toBe('VLAN 20')
  })

  it('preserves node properties through the round-trip', () => {
    const props = [
      { key: 'RAM', value: '32 GB', icon: 'MemoryStick', visible: true },
      { key: 'CPU', value: 'Intel i9', icon: 'Cpu', visible: false },
    ]
    const nodes = [makeNode('n1', { data: { label: 'n1', type: 'server', status: 'unknown', services: [], properties: props } })]
    const raw = standaloneSerialize(nodes, [])
    const { nodes: loaded } = standaloneDeserialize(raw)
    useCanvasStore.getState().loadCanvas(loaded, [])

    const stored = useCanvasStore.getState().nodes[0]
    expect(stored.data.properties).toEqual(props)
  })

  it('preserves empty properties array through the round-trip', () => {
    const nodes = [makeNode('n1', { data: { label: 'n1', type: 'server', status: 'unknown', services: [], properties: [] } })]
    const raw = standaloneSerialize(nodes, [])
    const { nodes: loaded } = standaloneDeserialize(raw)
    useCanvasStore.getState().loadCanvas(loaded, [])

    expect(useCanvasStore.getState().nodes[0].data.properties).toEqual([])
  })

  it('preserves edge waypoints through the round-trip', () => {
    const waypoints = [{ x: 100, y: 200 }, { x: 300, y: 150 }]
    const edges: Edge<EdgeData>[] = [{
      id: 'e1', source: 'n1', target: 'n2', type: 'ethernet',
      data: { type: 'ethernet', waypoints },
    }]
    const raw = standaloneSerialize([], edges)
    const { edges: loaded } = standaloneDeserialize(raw)
    useCanvasStore.getState().loadCanvas([], loaded)

    expect(useCanvasStore.getState().edges[0].data?.waypoints).toEqual(waypoints)
  })

  it('preserves basic animation through the round-trip', () => {
    const edges: Edge<EdgeData>[] = [{
      id: 'e1', source: 'n1', target: 'n2', type: 'ethernet',
      data: { type: 'ethernet', animated: 'basic' },
    }]
    const raw = standaloneSerialize([], edges)
    const { edges: loaded } = standaloneDeserialize(raw)
    useCanvasStore.getState().loadCanvas([], loaded)

    expect(useCanvasStore.getState().edges[0].data?.animated).toBe('basic')
  })

  it('preserves all three animation types through the round-trip', () => {
    const n1 = makeNode('n1')
    const n2 = makeNode('n2')
    const n3 = makeNode('n3')
    const edges: Edge<EdgeData>[] = [
      { id: 'e1', source: 'n1', target: 'n2', type: 'ethernet', data: { type: 'ethernet', animated: 'snake' } },
      { id: 'e2', source: 'n2', target: 'n3', type: 'ethernet', data: { type: 'ethernet', animated: 'flow' } },
      { id: 'e3', source: 'n1', target: 'n3', type: 'ethernet', data: { type: 'ethernet', animated: 'basic' } },
    ]
    const raw = standaloneSerialize([n1, n2, n3], edges)
    const { edges: loaded } = standaloneDeserialize(raw)
    useCanvasStore.getState().loadCanvas([n1, n2, n3], loaded)

    const stored = useCanvasStore.getState().edges
    expect(stored.find((e) => e.id === 'e1')?.data?.animated).toBe('snake')
    expect(stored.find((e) => e.id === 'e2')?.data?.animated).toBe('flow')
    expect(stored.find((e) => e.id === 'e3')?.data?.animated).toBe('basic')
  })

  // ── loadCanvas marks clean ────────────────────────────────────────────────

  it('loadCanvas sets hasUnsavedChanges to false', () => {
    useCanvasStore.setState({ hasUnsavedChanges: true })
    const { nodes: loaded } = standaloneDeserialize(standaloneSerialize([makeNode('n1')], []))
    useCanvasStore.getState().loadCanvas(loaded, [])
    expect(useCanvasStore.getState().hasUnsavedChanges).toBe(false)
  })
})

// ── Demo data validation ──────────────────────────────────────────────────────

describe('Demo data (standalone fallback)', () => {
  it('all demo nodes have required fields', () => {
    for (const n of demoNodes) {
      expect(n.id, `${n.id} missing id`).toBeTruthy()
      expect(n.type, `${n.id} missing type`).toBeTruthy()
      expect(n.position, `${n.id} missing position`).toBeDefined()
      expect(n.data.label, `${n.id} missing label`).toBeTruthy()
      expect(n.data.type, `${n.id} missing data.type`).toBeTruthy()
      expect(n.data.status, `${n.id} missing status`).toBeTruthy()
      expect(Array.isArray(n.data.services), `${n.id} services must be array`).toBe(true)
    }
  })

  it('demo nodes have no explicit width/height — render at natural size', () => {
    for (const n of demoNodes) {
      expect(n.width, `${n.id} should not have explicit width`).toBeUndefined()
      expect(n.height, `${n.id} should not have explicit height`).toBeUndefined()
    }
  })

  it('all demo edges reference valid node ids', () => {
    const nodeIds = new Set(demoNodes.map((n) => n.id))
    for (const e of demoEdges) {
      expect(nodeIds.has(e.source), `edge ${e.id} source '${e.source}' not in nodes`).toBe(true)
      expect(nodeIds.has(e.target), `edge ${e.id} target '${e.target}' not in nodes`).toBe(true)
    }
  })

  it('demo data loads into store without errors', () => {
    useCanvasStore.getState().loadCanvas(demoNodes, demoEdges)
    const { nodes, edges } = useCanvasStore.getState()
    expect(nodes).toHaveLength(demoNodes.length)
    expect(edges).toHaveLength(demoEdges.length)
  })

  it('demo data round-trips through standalone JSON serialization', () => {
    const raw = standaloneSerialize(demoNodes, demoEdges)
    const { nodes: loaded, edges: loadedEdges } = standaloneDeserialize(raw)
    useCanvasStore.getState().loadCanvas(loaded, loadedEdges)

    const { nodes, edges } = useCanvasStore.getState()
    expect(nodes).toHaveLength(demoNodes.length)
    expect(edges).toHaveLength(demoEdges.length)
    // Positions intact
    const router = nodes.find((n) => n.id === 'router-1')!
    expect(router.position).toEqual({ x: 300, y: 140 })
  })
})

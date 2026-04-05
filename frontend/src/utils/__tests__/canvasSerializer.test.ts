import { describe, it, expect } from 'vitest'
import type { Node, Edge } from '@xyflow/react'
import type { NodeData, EdgeData } from '@/types'
import {
  serializeNode,
  serializeEdge,
  deserializeApiNode,
  deserializeApiEdge,
  type ApiNode,
  type ApiEdge,
} from '@/utils/canvasSerializer'

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeRfNode(overrides: Partial<Node<NodeData>> = {}): Node<NodeData> {
  return {
    id: 'n1',
    type: 'server',
    position: { x: 100, y: 200 },
    data: {
      label: 'My Server',
      type: 'server',
      status: 'online',
      services: [],
    },
    ...overrides,
  }
}

function makeApiNode(overrides: Partial<ApiNode> = {}): ApiNode {
  return {
    id: 'n1',
    type: 'server',
    label: 'My Server',
    pos_x: 100,
    pos_y: 200,
    status: 'online',
    services: [],
    ...overrides,
  }
}

function makeRfEdge(overrides: Partial<Edge<EdgeData>> = {}): Edge<EdgeData> {
  return {
    id: 'e1',
    source: 'n1',
    target: 'n2',
    type: 'ethernet',
    data: { type: 'ethernet' },
    ...overrides,
  }
}

function makeApiEdge(overrides: Partial<ApiEdge> = {}): ApiEdge {
  return {
    id: 'e1',
    source: 'n1',
    target: 'n2',
    type: 'ethernet',
    ...overrides,
  }
}

// ── serializeNode — regular nodes ────────────────────────────────────────────

describe('serializeNode — regular node', () => {
  it('maps position to pos_x/pos_y', () => {
    const result = serializeNode(makeRfNode({ position: { x: 42, y: 99 } }))
    expect(result.pos_x).toBe(42)
    expect(result.pos_y).toBe(99)
  })

  it('includes all data fields', () => {
    const node = makeRfNode({
      data: {
        label: 'Router', type: 'router', status: 'online', services: [],
        hostname: 'gw.local', ip: '192.168.1.1', mac: 'aa:bb:cc:dd:ee:ff',
        os: 'OpenWRT', check_method: 'ping', check_target: '192.168.1.1',
        notes: 'main router',
      },
    })
    const result = serializeNode(node)
    expect(result.hostname).toBe('gw.local')
    expect(result.ip).toBe('192.168.1.1')
    expect(result.mac).toBe('aa:bb:cc:dd:ee:ff')
    expect(result.os).toBe('OpenWRT')
    expect(result.check_method).toBe('ping')
    expect(result.check_target).toBe('192.168.1.1')
    expect(result.notes).toBe('main router')
  })

  it('serializes width and height when node has been resized', () => {
    const node = makeRfNode({ width: 280, height: 120 })
    const result = serializeNode(node)
    expect(result.width).toBe(280)
    expect(result.height).toBe(120)
  })

  it('prefers measured dimensions for regular nodes', () => {
    const node: Node<NodeData> = {
      ...makeRfNode({ width: 280, height: 120 }),
      measured: { width: 312, height: 144 },
    }
    const result = serializeNode(node)
    expect(result.width).toBe(312)
    expect(result.height).toBe(144)
  })

  it('serializes width/height as null when node has default size', () => {
    const result = serializeNode(makeRfNode())
    expect(result.width).toBeNull()
    expect(result.height).toBeNull()
  })

  it('serializes hardware fields', () => {
    const node = makeRfNode({
      data: {
        label: 'Server', type: 'server', status: 'online', services: [],
        cpu_count: 8, cpu_model: 'Intel i7', ram_gb: 32, disk_gb: 500, show_hardware: true,
      },
    })
    const result = serializeNode(node)
    expect(result.cpu_count).toBe(8)
    expect(result.cpu_model).toBe('Intel i7')
    expect(result.ram_gb).toBe(32)
    expect(result.disk_gb).toBe(500)
    expect(result.show_hardware).toBe(true)
  })

  it('serializes custom_colors', () => {
    const node = makeRfNode({ data: { label: 'S', type: 'server', status: 'unknown', services: [], custom_colors: { border: '#ff0000' } } })
    const result = serializeNode(node)
    expect(result.custom_colors).toEqual({ border: '#ff0000' })
  })

  it('serializes parent_id and container_mode', () => {
    const node = makeRfNode({ data: { label: 'VM', type: 'vm', status: 'unknown', services: [], parent_id: 'px1', container_mode: false } })
    const result = serializeNode(node)
    expect(result.parent_id).toBe('px1')
    expect(result.container_mode).toBe(false)
  })

  it('nulls optional fields when absent', () => {
    const result = serializeNode(makeRfNode())
    expect(result.hostname).toBeNull()
    expect(result.ip).toBeNull()
    expect(result.mac).toBeNull()
    expect(result.os).toBeNull()
    expect(result.check_method).toBeNull()
    expect(result.check_target).toBeNull()
    expect(result.notes).toBeNull()
    expect(result.parent_id).toBeNull()
    expect(result.cpu_count).toBeNull()
    expect(result.cpu_model).toBeNull()
    expect(result.ram_gb).toBeNull()
    expect(result.disk_gb).toBeNull()
  })
})

// ── serializeNode — groupRect ─────────────────────────────────────────────────

describe('serializeNode — groupRect', () => {
  it('stores dimensions inside custom_colors', () => {
    const node = makeRfNode({
      type: 'groupRect',
      data: { label: 'Zone A', type: 'groupRect', status: 'unknown', services: [] },
      width: 400,
      height: 250,
    })
    const result = serializeNode(node)
    expect((result.custom_colors as Record<string, unknown>).width).toBe(400)
    expect((result.custom_colors as Record<string, unknown>).height).toBe(250)
  })

  it('falls back to measured dimensions over explicit width/height', () => {
    const node: Node<NodeData> = {
      ...makeRfNode({ type: 'groupRect', data: { label: 'Z', type: 'groupRect', status: 'unknown', services: [] }, width: 400 }),
      measured: { width: 420, height: 260 },
    }
    const result = serializeNode(node)
    expect((result.custom_colors as Record<string, unknown>).width).toBe(420)
    expect((result.custom_colors as Record<string, unknown>).height).toBe(260)
  })

  it('falls back to defaults when no dimensions available', () => {
    const node = makeRfNode({ type: 'groupRect', data: { label: 'Z', type: 'groupRect', status: 'unknown', services: [] } })
    const result = serializeNode(node)
    expect((result.custom_colors as Record<string, unknown>).width).toBe(360)
    expect((result.custom_colors as Record<string, unknown>).height).toBe(240)
  })

  it('preserves existing custom_colors fields alongside dimensions', () => {
    const node = makeRfNode({
      type: 'groupRect',
      data: { label: 'Z', type: 'groupRect', status: 'unknown', services: [], custom_colors: { border: '#aaa', z_order: 2 } },
      width: 300, height: 200,
    })
    const result = serializeNode(node)
    const cc = result.custom_colors as Record<string, unknown>
    expect(cc.border).toBe('#aaa')
    expect(cc.z_order).toBe(2)
    expect(cc.width).toBe(300)
    expect(cc.height).toBe(200)
  })
})

// ── serializeEdge ─────────────────────────────────────────────────────────────

describe('serializeEdge', () => {
  it('serializes basic fields', () => {
    const result = serializeEdge(makeRfEdge())
    expect(result.id).toBe('e1')
    expect(result.source).toBe('n1')
    expect(result.target).toBe('n2')
    expect(result.type).toBe('ethernet')
  })

  it('normalizes top-t handle to top', () => {
    const result = serializeEdge(makeRfEdge({ sourceHandle: 'top-t', targetHandle: 'bottom-t' }))
    expect(result.source_handle).toBe('top')
    expect(result.target_handle).toBe('bottom')
  })

  it('passes through non-stub handles unchanged', () => {
    const result = serializeEdge(makeRfEdge({ sourceHandle: 'cluster-right', targetHandle: 'cluster-left' }))
    expect(result.source_handle).toBe('cluster-right')
    expect(result.target_handle).toBe('cluster-left')
  })

  it('serializes optional edge data', () => {
    const edge = makeRfEdge({ data: { type: 'vlan', label: 'uplink', vlan_id: 10, custom_color: '#ff0', path_style: 'smooth', animated: true } })
    const result = serializeEdge(edge)
    expect(result.label).toBe('uplink')
    expect(result.vlan_id).toBe(10)
    expect(result.custom_color).toBe('#ff0')
    expect(result.path_style).toBe('smooth')
    expect(result.animated).toBe(true)
  })

  it('nulls optional fields when absent', () => {
    const result = serializeEdge(makeRfEdge({ sourceHandle: undefined, targetHandle: undefined }))
    expect(result.source_handle).toBeNull()
    expect(result.target_handle).toBeNull()
    expect(result.label).toBeNull()
    expect(result.vlan_id).toBeNull()
    expect(result.custom_color).toBeNull()
    expect(result.path_style).toBeNull()
  })
})

// ── deserializeApiNode — regular nodes ───────────────────────────────────────

describe('deserializeApiNode — regular node', () => {
  const emptyMap = new Map<string, boolean>()

  it('maps pos_x/pos_y to position', () => {
    const result = deserializeApiNode(makeApiNode({ pos_x: 50, pos_y: 75 }), emptyMap)
    expect(result.position).toEqual({ x: 50, y: 75 })
  })

  it('restores width and height when node was resized', () => {
    const result = deserializeApiNode(makeApiNode({ width: 280, height: 120 }), emptyMap)
    expect(result.width).toBe(280)
    expect(result.height).toBe(120)
  })

  it('leaves width/height undefined for default-sized nodes', () => {
    const result = deserializeApiNode(makeApiNode(), emptyMap)
    expect(result.width).toBeUndefined()
    expect(result.height).toBeUndefined()
  })

  it('sets parentId and extent for children of container proxmox', () => {
    const map = new Map([['px1', true]])
    const result = deserializeApiNode(makeApiNode({ parent_id: 'px1' }), map)
    expect(result.parentId).toBe('px1')
    expect(result.extent).toBe('parent')
  })

  it('does not set parentId when parent is not in container mode', () => {
    const map = new Map([['px1', false]])
    const result = deserializeApiNode(makeApiNode({ parent_id: 'px1' }), map)
    expect(result.parentId).toBeUndefined()
  })

  it('sets proxmox dimensions using saved values', () => {
    const result = deserializeApiNode(
      makeApiNode({ type: 'proxmox', container_mode: true, width: 450, height: 300 }),
      emptyMap,
    )
    expect(result.width).toBe(450)
    expect(result.height).toBe(300)
  })

  it('falls back to 300x200 for proxmox container with no saved dimensions', () => {
    const result = deserializeApiNode(makeApiNode({ type: 'proxmox', container_mode: true }), emptyMap)
    expect(result.width).toBe(300)
    expect(result.height).toBe(200)
  })

  it('does not set dimensions for non-container proxmox', () => {
    const result = deserializeApiNode(makeApiNode({ type: 'proxmox', container_mode: false }), emptyMap)
    expect(result.width).toBeUndefined()
    expect(result.height).toBeUndefined()
  })
})

// ── deserializeApiNode — groupRect ────────────────────────────────────────────

describe('deserializeApiNode — groupRect', () => {
  const emptyMap = new Map<string, boolean>()

  it('restores width/height from custom_colors', () => {
    const result = deserializeApiNode(
      makeApiNode({ type: 'groupRect', custom_colors: { width: 400, height: 250, z_order: 2 } }),
      emptyMap,
    )
    expect(result.width).toBe(400)
    expect(result.height).toBe(250)
    expect(result.zIndex).toBe(-8)
  })

  it('defaults to 360x240 when custom_colors has no dimensions', () => {
    const result = deserializeApiNode(makeApiNode({ type: 'groupRect' }), emptyMap)
    expect(result.width).toBe(360)
    expect(result.height).toBe(240)
  })
})

// ── deserializeApiEdge ────────────────────────────────────────────────────────

describe('deserializeApiEdge', () => {
  it('maps source_handle/target_handle to sourceHandle/targetHandle', () => {
    const result = deserializeApiEdge(makeApiEdge({ source_handle: 'top', target_handle: 'bottom' }))
    expect(result.sourceHandle).toBe('top')
    expect(result.targetHandle).toBe('bottom')
  })

  it('sets sourceHandle/targetHandle to null when absent', () => {
    const result = deserializeApiEdge(makeApiEdge())
    expect(result.sourceHandle).toBeNull()
    expect(result.targetHandle).toBeNull()
  })

  it('preserves id, source, target, type', () => {
    const result = deserializeApiEdge(makeApiEdge({ id: 'e99', source: 'a', target: 'b', type: 'wifi' }))
    expect(result.id).toBe('e99')
    expect(result.source).toBe('a')
    expect(result.target).toBe('b')
    expect(result.type).toBe('wifi')
  })
})

// ── Round-trip ────────────────────────────────────────────────────────────────

describe('round-trip: serialize → deserialize', () => {
  const emptyMap = new Map<string, boolean>()

  it('preserves position through serialize/deserialize', () => {
    const node = makeRfNode({ position: { x: 123, y: 456 } })
    const serialized = serializeNode(node) as ApiNode
    const restored = deserializeApiNode(serialized, emptyMap)
    expect(restored.position).toEqual({ x: 123, y: 456 })
  })

  it('preserves width/height through serialize/deserialize', () => {
    const node = makeRfNode({ width: 300, height: 160 })
    const serialized = serializeNode(node) as ApiNode
    const restored = deserializeApiNode(serialized, emptyMap)
    expect(restored.width).toBe(300)
    expect(restored.height).toBe(160)
  })

  it('preserves null width/height for default-sized nodes', () => {
    const node = makeRfNode()
    const serialized = serializeNode(node) as ApiNode
    const restored = deserializeApiNode(serialized, emptyMap)
    expect(restored.width).toBeUndefined()
    expect(restored.height).toBeUndefined()
  })

  it('preserves groupRect dimensions through serialize/deserialize', () => {
    const node = makeRfNode({
      type: 'groupRect',
      data: { label: 'Z', type: 'groupRect', status: 'unknown', services: [] },
      width: 500,
      height: 300,
    })
    const serialized = serializeNode(node) as ApiNode
    const restored = deserializeApiNode(serialized, emptyMap)
    expect(restored.width).toBe(500)
    expect(restored.height).toBe(300)
  })
})

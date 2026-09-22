import { describe, it, expect } from 'vitest'
import type { Node, Edge } from '@xyflow/react'
import type { NodeData, EdgeData } from '@/types'
import {
  groupIntoZones,
  liftEdgesToTopLevel,
  subnetGroupLabel,
  typeGroupLabel,
} from '../zoneGrouping'
import { applyDagreLayout } from '../layout'

function node(id: string, type: string, extra: Partial<Node<NodeData>> & { ip?: string; label?: string } = {}): Node<NodeData> {
  const { ip, label, ...rest } = extra
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    data: { type, label: label ?? id, ip, status: 'unknown', services: [] } as unknown as NodeData,
    ...rest,
  }
}

function edge(source: string, target: string, extra: Partial<Edge<EdgeData>> = {}): Edge<EdgeData> {
  return { id: `${source}-${target}`, source, target, data: {} as EdgeData, ...extra }
}

let seq = 0
const ids = () => `zone-${++seq}`

const zonesOf = (nodes: Node<NodeData>[]) => nodes.filter((n) => n.data.type === 'groupRect')
const zoneLabelled = (nodes: Node<NodeData>[], label: string) => zonesOf(nodes).find((z) => z.data.label === label)!

function overlaps(a: Node<NodeData>, b: Node<NodeData>, w = 160, h = 90) {
  return a.position.x < b.position.x + w && b.position.x < a.position.x + w
    && a.position.y < b.position.y + h && b.position.y < a.position.y + h
}

describe('typeGroupLabel', () => {
  it('maps a type to its picker family', () => {
    expect(typeGroupLabel('switch')).toBe('Hardware')
    expect(typeGroupLabel('lxc')).toBe('Virtualization')
    expect(typeGroupLabel('zigbee_router')).toBe('Zigbee')
  })

  it('files an unknown type under Other', () => {
    expect(typeGroupLabel('mystery_box')).toBe('Other')
  })
})

describe('subnetGroupLabel', () => {
  it('returns the /24 of an address', () => {
    expect(subnetGroupLabel('192.168.1.42')).toBe('192.168.1.0/24')
  })

  it('strips a stored prefix or port', () => {
    expect(subnetGroupLabel('10.0.5.7/16')).toBe('10.0.5.0/24')
    expect(subnetGroupLabel('10.0.5.7:8006')).toBe('10.0.5.0/24')
  })

  it('is null for a missing or non-IPv4 address', () => {
    expect(subnetGroupLabel(undefined)).toBeNull()
    expect(subnetGroupLabel('')).toBeNull()
    expect(subnetGroupLabel('fe80::1')).toBeNull()
    expect(subnetGroupLabel('nas.local')).toBeNull()
  })
})

describe('groupIntoZones', () => {
  it('creates one zone per family and nests every free device in it', () => {
    const nodes = [node('sw', 'switch'), node('srv', 'server'), node('vm1', 'vm'), node('ct1', 'lxc')]
    const { nodes: out, moved, zonesCreated } = groupIntoZones(nodes, 'type', ids)

    expect(moved).toBe(4)
    expect(zonesCreated).toBe(2)
    const hw = zoneLabelled(out, 'Hardware')
    const virt = zoneLabelled(out, 'Virtualization')
    expect(out.find((n) => n.id === 'sw')!.parentId).toBe(hw.id)
    expect(out.find((n) => n.id === 'srv')!.parentId).toBe(hw.id)
    expect(out.find((n) => n.id === 'vm1')!.parentId).toBe(virt.id)
    expect(out.find((n) => n.id === 'vm1')!.data.parent_id).toBe(virt.id)
  })

  it('groups by /24 and leaves a device with no IP loose', () => {
    const nodes = [
      node('a', 'server', { ip: '192.168.1.10' }),
      node('b', 'nas', { ip: '192.168.1.20' }),
      node('c', 'vm', { ip: '10.0.0.5' }),
      node('d', 'computer'),
    ]
    const { nodes: out, moved } = groupIntoZones(nodes, 'subnet', ids)

    expect(moved).toBe(3)
    expect(zonesOf(out).map((z) => z.data.label)).toEqual(['10.0.0.0/24', '192.168.1.0/24'])
    const lan = zoneLabelled(out, '192.168.1.0/24')
    expect(out.find((n) => n.id === 'a')!.parentId).toBe(lan.id)
    expect(out.find((n) => n.id === 'b')!.parentId).toBe(lan.id)
    expect(out.find((n) => n.id === 'd')!.parentId).toBeUndefined()
  })

  it('never moves a nested node or canvas furniture', () => {
    const nodes = [
      node('pve', 'proxmox', { width: 300, height: 200 }),
      node('vm1', 'vm', { parentId: 'pve' }),
      node('note', 'text'),
      node('g', 'group'),
    ]
    const { nodes: out, moved } = groupIntoZones(nodes, 'type', ids)

    expect(moved).toBe(1)
    const virt = zoneLabelled(out, 'Virtualization')
    expect(out.find((n) => n.id === 'pve')!.parentId).toBe(virt.id)
    expect(out.find((n) => n.id === 'vm1')!.parentId).toBe('pve')
    expect(out.find((n) => n.id === 'note')!.parentId).toBeUndefined()
    expect(out.find((n) => n.id === 'g')!.parentId).toBeUndefined()
  })

  it('reuses a zone that already carries the label, whatever its case', () => {
    const zone = node('mine', 'groupRect', { label: ' hardware ', width: 500, height: 300 })
    const { nodes: out, zonesCreated } = groupIntoZones([zone, node('sw', 'switch')], 'type', ids)

    expect(zonesCreated).toBe(0)
    expect(zonesOf(out)).toHaveLength(1)
    expect(out.find((n) => n.id === 'sw')!.parentId).toBe('mine')
  })

  it('is stable on a second run: nothing moves, no zone is added', () => {
    const first = groupIntoZones([node('sw', 'switch'), node('vm1', 'vm')], 'type', ids)
    const second = groupIntoZones(first.nodes, 'type', ids)

    expect(second.moved).toBe(0)
    expect(second.zonesCreated).toBe(0)
    expect(second.nodes).toBe(first.nodes)
  })

  it('packs arrivals below what a reused zone already holds', () => {
    const zone = node('z', 'groupRect', { label: 'Hardware', width: 400, height: 240 })
    const kept = node('kept', 'router', { parentId: 'z', position: { x: 16, y: 40 }, width: 160, height: 90 })
    const { nodes: out } = groupIntoZones([zone, kept, node('sw', 'switch')], 'type', ids)

    const sw = out.find((n) => n.id === 'sw')!
    expect(sw.position.y).toBeGreaterThanOrEqual(40 + 90)
    expect(out.find((n) => n.id === 'kept')!.position).toEqual({ x: 16, y: 40 })
  })

  it('lays members out without overlap and grows the zone to cover them', () => {
    const nodes = Array.from({ length: 9 }, (_, i) => node(`s${i}`, 'server'))
    const { nodes: out } = groupIntoZones(nodes, 'type', ids)

    const zone = zoneLabelled(out, 'Hardware')
    const members = out.filter((n) => n.parentId === zone.id)
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) expect(overlaps(members[i], members[j])).toBe(false)
    }
    for (const m of members) {
      expect(m.position.x + 160).toBeLessThanOrEqual(zone.width!)
      expect(m.position.y + 90).toBeLessThanOrEqual(zone.height!)
    }
  })

  it('makes room for a member larger than a card', () => {
    const pve = node('pve', 'proxmox', { width: 600, height: 400 })
    const { nodes: out } = groupIntoZones([pve, node('vm', 'vm')], 'type', ids)

    const zone = zoneLabelled(out, 'Virtualization')
    expect(zone.width!).toBeGreaterThanOrEqual(600 + 32)
    expect(zone.height!).toBeGreaterThanOrEqual(400 + 40)
  })

  it('never shrinks a reused zone', () => {
    const zone = node('z', 'groupRect', { label: 'Hardware', width: 900, height: 700 })
    const { nodes: out } = groupIntoZones([zone, node('sw', 'switch')], 'type', ids)

    expect(out.find((n) => n.id === 'z')!.width).toBe(900)
    expect(out.find((n) => n.id === 'z')!.height).toBe(700)
  })

  it('returns the input untouched when there is nothing to group', () => {
    const nodes = [node('d', 'computer')]
    const res = groupIntoZones(nodes, 'subnet', ids)
    expect(res).toEqual({ nodes, moved: 0, zonesCreated: 0 })
  })
})

describe('liftEdgesToTopLevel', () => {
  const nodes = [
    node('router', 'router'),
    node('z', 'groupRect'),
    node('pve', 'proxmox', { parentId: 'z' }),
    node('vm', 'vm', { parentId: 'pve' }),
    node('srv', 'server', { parentId: 'z' }),
  ]

  it('re-points a nested end at its top-level box and drops its handle', () => {
    const [e] = liftEdgesToTopLevel(nodes, [edge('router', 'vm', { sourceHandle: 'bottom-2', targetHandle: 'top' })])
    expect(e).toMatchObject({ source: 'router', target: 'z', sourceHandle: 'bottom-2', targetHandle: null })
  })

  it('drops an edge whose two ends share a box, and collapses duplicates', () => {
    const lifted = liftEdgesToTopLevel(nodes, [
      edge('pve', 'srv'),
      edge('router', 'vm'),
      edge('router', 'srv'),
    ])
    expect(lifted.map((e) => [e.source, e.target])).toEqual([['router', 'z']])
  })

  it('drops an edge to a node that does not exist', () => {
    expect(liftEdgesToTopLevel(nodes, [edge('router', 'ghost')])).toEqual([])
  })
})

describe('grouping then Dagre (the Auto Layout path)', () => {
  it('stacks the zones under the router they hang off, side by side', () => {
    const nodes = [
      node('router', 'router'),
      ...['1', '2', '3'].map((i) => node(`lan${i}`, 'server', { ip: `192.168.1.${i}` })),
      ...['1', '2'].map((i) => node(`iot${i}`, 'iot', { ip: `192.168.50.${i}` })),
    ]
    const edges = [...nodes.slice(1).map((n) => edge('router', n.id))]

    const grouped = groupIntoZones(nodes, 'subnet', ids)
    const laid = applyDagreLayout(grouped.nodes, liftEdgesToTopLevel(grouped.nodes, edges))

    const router = laid.find((n) => n.id === 'router')!
    const [a, b] = zonesOf(laid)
    for (const z of [a, b]) expect(z.position.y).toBeGreaterThanOrEqual(router.position.y + 52)
    // Same rank: Dagre centres boxes of different heights on it.
    expect(a.position.y + a.height! / 2).toBe(b.position.y + b.height! / 2)
    const [left, right] = a.position.x < b.position.x ? [a, b] : [b, a]
    expect(left.position.x + left.width!).toBeLessThanOrEqual(right.position.x)
  })
})


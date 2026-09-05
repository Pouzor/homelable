import type { Node } from '@xyflow/react'
import { describe, expect, it } from 'vitest'

import type { Design, InventoryEntry, NodeData } from '@/types'
import {
  bucketsFor,
  buildDeviceTree,
  buildLibraryTree,
  deviceLabel,
  docState,
  filterGroups,
  filterTree,
  nodeFactsByDevice,
  physicality,
  slash24,
  splitIps,
  subnetsOf,
} from '../tree'
import type { DocumentSummary } from '../types'

function device(overrides: Partial<InventoryEntry> = {}): InventoryEntry {
  return {
    id: 'dev-1',
    ip: '192.168.1.20',
    mac: null,
    hostname: 'nas-01.lan',
    os: null,
    services: [],
    suggested_type: null,
    status: 'approved',
    discovered_at: '2026-01-01T00:00:00Z',
    label: 'nas-01',
    ...overrides,
  }
}

function doc(overrides: Partial<DocumentSummary> = {}): DocumentSummary {
  return {
    id: 'doc-1',
    kind: 'device',
    title: 'nas-01',
    slug: 'nas-01',
    sort_order: 0,
    tags: [],
    frontmatter: {},
    starred: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function node(id: string, data: Partial<NodeData>): Node<NodeData> {
  return {
    id,
    position: { x: 0, y: 0 },
    data: { label: id, type: 'server', status: 'unknown', services: [], ...data } as NodeData,
  }
}

const designs: Design[] = [
  { id: 'design-1', name: 'Home network', design_type: 'network' } as Design,
]

const emptyContext = { nodes: [], designs, activeDesignId: 'design-1' as string | null }

// ── helpers ─────────────────────────────────────────────────────────────────

describe('physicality', () => {
  it('calls a guest virtual', () => {
    expect(physicality('vm')).toBe('Virtual')
    expect(physicality('lxc')).toBe('Virtual')
    expect(physicality('docker_container')).toBe('Virtual')
  })

  it('calls a hypervisor a host', () => {
    expect(physicality('proxmox')).toBe('Host')
    expect(physicality('docker_host')).toBe('Host')
  })

  it('falls back to a container drawing when the type is generic', () => {
    expect(physicality('server', { hasChildren: true })).toBe('Host')
    expect(physicality('server', { containerMode: true })).toBe('Host')
  })

  it('is physical otherwise, including for an unknown type', () => {
    expect(physicality('nas')).toBe('Physical')
    expect(physicality(null)).toBe('Physical')
  })
})

describe('splitIps', () => {
  it('splits the comma-separated column and drops blanks', () => {
    expect(splitIps('10.0.0.1, 192.168.1.2 ,')).toEqual(['10.0.0.1', '192.168.1.2'])
    expect(splitIps(null)).toEqual([])
  })
})

describe('slash24', () => {
  it('is the network of an IPv4 address', () => {
    expect(slash24('192.168.1.20')).toBe('192.168.1.0/24')
  })

  it('is null for anything that is not IPv4', () => {
    expect(slash24('fe80::1')).toBeNull()
    expect(slash24('not-an-ip')).toBeNull()
  })
})

describe('subnetsOf', () => {
  it('prefers a configured range over the guessed /24', () => {
    expect(subnetsOf(device({ ip: '10.0.5.7' }), ['10.0.0.0/16'])).toEqual(['10.0.0.0/16'])
  })

  it('guesses a /24 when no range matches', () => {
    expect(subnetsOf(device({ ip: '10.0.5.7' }), ['192.168.1.0/24'])).toEqual(['10.0.5.0/24'])
  })

  it('places a multi-homed device under every subnet it reaches', () => {
    const found = subnetsOf(device({ ip: '10.0.0.5, 192.168.1.20' }), [])
    expect(found).toEqual(['10.0.0.0/24', '192.168.1.0/24'])
  })

  it('falls back to a single bucket for a device with no usable address', () => {
    expect(subnetsOf(device({ ip: null }), [])).toEqual(['Ungrouped'])
  })
})

describe('deviceLabel', () => {
  it('falls back through the names a device can carry', () => {
    expect(deviceLabel(device())).toBe('nas-01')
    expect(deviceLabel(device({ label: null }))).toBe('nas-01.lan')
    expect(deviceLabel(device({ label: null, hostname: null }))).toBe('192.168.1.20')
    expect(deviceLabel(device({ label: null, hostname: null, ip: null }))).toBe('Unnamed device')
  })
})

describe('docState', () => {
  it('reports what the badge should say', () => {
    expect(docState(undefined)).toBe('none')
    expect(docState(doc())).toBe('header-only')
    expect(docState(doc({ edited_at: '2026-02-01T00:00:00Z' }))).toBe('written')
    expect(docState(doc(), { drifted: true })).toBe('drifted')
    expect(docState(doc(), { overdue: true })).toBe('overdue')
  })

  it('reports drift ahead of an overdue review — it is the more actionable one', () => {
    expect(docState(doc(), { drifted: true, overdue: true })).toBe('drifted')
  })
})

// ── canvas facts ────────────────────────────────────────────────────────────

describe('nodeFactsByDevice', () => {
  it('walks up to the nearest zone and the nearest group', () => {
    const nodes = [
      node('zone', { type: 'groupRect', label: 'Garage' }),
      node('group', { type: 'group', label: 'Storage', parent_id: 'zone' }),
      node('nas', { type: 'nas', label: 'nas-01', parent_id: 'group', device_id: 'dev-1' }),
    ]
    const facts = nodeFactsByDevice({ ...emptyContext, nodes })
    expect(facts['dev-1'].zone).toBe('Garage')
    expect(facts['dev-1'].group).toBe('Storage')
  })

  it('ignores furniture, which describes nothing', () => {
    const nodes = [node('zone', { type: 'groupRect', label: 'Garage', device_id: 'dev-1' })]
    expect(nodeFactsByDevice({ ...emptyContext, nodes })).toEqual({})
  })

  it('names the canvas the loaded nodes belong to', () => {
    const nodes = [node('nas', { type: 'nas', device_id: 'dev-1' })]
    expect(nodeFactsByDevice({ ...emptyContext, nodes })['dev-1'].canvas).toBe('Home network')
  })

  it('survives a parent cycle rather than recursing forever', () => {
    const nodes = [
      node('a', { type: 'groupRect', label: 'A', parent_id: 'b' }),
      node('b', { type: 'groupRect', label: 'B', parent_id: 'a' }),
      node('nas', { type: 'nas', parent_id: 'a', device_id: 'dev-1' }),
    ]
    expect(() => nodeFactsByDevice({ ...emptyContext, nodes })).not.toThrow()
  })
})

// ── the pivots ──────────────────────────────────────────────────────────────

describe('bucketsFor', () => {
  const facts = { zone: 'Garage', group: 'Storage', hasChildren: false, containerMode: false }

  it('groups by zone, falling back when there is none', () => {
    expect(bucketsFor(device(), 'zone', facts, undefined, emptyContext)).toEqual(['Garage'])
    expect(bucketsFor(device(), 'zone', undefined, undefined, emptyContext)).toEqual(['Unzoned'])
  })

  it('groups by the curated type before the guessed one', () => {
    expect(bucketsFor(device({ type: 'nas', suggested_type: 'server' }), 'type', facts, undefined, emptyContext)).toEqual(['nas'])
    expect(bucketsFor(device({ type: null, suggested_type: 'server' }), 'type', facts, undefined, emptyContext)).toEqual(['server'])
    expect(bucketsFor(device({ type: null, suggested_type: null }), 'type', facts, undefined, emptyContext)).toEqual(['Untyped'])
  })

  it('groups by every discovery source that saw the device', () => {
    const merged = device({ discovery_sources: ['arp', 'proxmox'] })
    expect(bucketsFor(merged, 'source', facts, undefined, emptyContext)).toEqual(['arp', 'proxmox'])
  })

  it('falls back to the single source column on an older row', () => {
    const legacy = device({ discovery_sources: [], discovery_source: 'mdns' })
    expect(bucketsFor(legacy, 'source', facts, undefined, emptyContext)).toEqual(['mdns'])
  })

  it('groups by rack when one mounts the device', () => {
    const context = { ...emptyContext, racksByDevice: { 'dev-1': 'Rack-A' } }
    expect(bucketsFor(device(), 'rack', facts, undefined, context)).toEqual(['Rack-A'])
    expect(bucketsFor(device(), 'rack', facts, undefined, emptyContext)).toEqual(['Not racked'])
  })

  it('groups by the tags on the document, not on the device', () => {
    expect(bucketsFor(device(), 'tag', facts, doc({ tags: ['storage', 'loud'] }), emptyContext)).toEqual([
      'storage',
      'loud',
    ])
    expect(bucketsFor(device(), 'tag', facts, doc(), emptyContext)).toEqual(['Untagged'])
  })

  it('puts everything in one bucket when flat', () => {
    expect(bucketsFor(device(), 'flat', facts, undefined, emptyContext)).toEqual(['All devices'])
  })
})

describe('buildDeviceTree', () => {
  it('groups devices and sorts them inside each group', () => {
    const devices = [
      device({ id: 'a', label: 'zeta', ip: '10.0.0.1' }),
      device({ id: 'b', label: 'alpha', ip: '10.0.0.2' }),
    ]
    const groups = buildDeviceTree({ groupBy: 'flat', devices, docs: [], context: emptyContext })
    expect(groups).toHaveLength(1)
    expect(groups[0].items.map((i) => i.label)).toEqual(['alpha', 'zeta'])
  })

  it('marks a device with no document so the tree shows the gap', () => {
    const groups = buildDeviceTree({ groupBy: 'flat', devices: [device()], docs: [], context: emptyContext })
    expect(groups[0].items[0].kind).toBe('device-without-doc')
    expect(groups[0].items[0].state).toBe('none')
    expect(groups[0].items[0].docId).toBeUndefined()
  })

  it('attaches the document a device already has', () => {
    const groups = buildDeviceTree({
      groupBy: 'flat',
      devices: [device()],
      docs: [doc({ device_id: 'dev-1', edited_at: '2026-02-01T00:00:00Z' })],
      context: emptyContext,
    })
    expect(groups[0].items[0].docId).toBe('doc-1')
    expect(groups[0].items[0].state).toBe('written')
  })

  it('lists a multi-homed device under each of its subnets', () => {
    const groups = buildDeviceTree({
      groupBy: 'subnet',
      devices: [device({ ip: '10.0.0.5, 192.168.1.20' })],
      docs: [],
      context: emptyContext,
    })
    expect(groups.map((g) => g.label)).toEqual(['10.0.0.0/24', '192.168.1.0/24'])
  })

  it('sinks the catch-all bucket to the bottom', () => {
    const devices = [
      device({ id: 'a', label: 'in-a-zone' }),
      device({ id: 'b', label: 'loose' }),
    ]
    const nodes = [
      node('zone', { type: 'groupRect', label: 'Garage' }),
      node('n', { type: 'nas', parent_id: 'zone', device_id: 'a' }),
    ]
    const groups = buildDeviceTree({
      groupBy: 'zone',
      devices,
      docs: [],
      context: { ...emptyContext, nodes },
    })
    expect(groups.map((g) => g.label)).toEqual(['Garage', 'Unzoned'])
  })

  it('flags drift and overdue review from the sets it is given', () => {
    const groups = buildDeviceTree({
      groupBy: 'flat',
      devices: [device()],
      docs: [doc({ device_id: 'dev-1' })],
      context: emptyContext,
      drifted: new Set(['doc-1']),
    })
    expect(groups[0].items[0].state).toBe('drifted')
  })
})

// ── the library ─────────────────────────────────────────────────────────────

describe('buildLibraryTree', () => {
  it('nests pages under their folder', () => {
    const tree = buildLibraryTree([
      doc({ id: 'f', kind: 'folder', title: 'Runbooks' }),
      doc({ id: 'p', kind: 'page', title: 'Reboot', parent_id: 'f' }),
    ])
    expect(tree).toHaveLength(1)
    expect(tree[0].children?.[0].label).toBe('Reboot')
  })

  it('leaves device documents out — they are placed by their pivot', () => {
    expect(buildLibraryTree([doc({ kind: 'device', device_id: 'dev-1' })])).toEqual([])
  })

  it('orders by sort_order, then by title', () => {
    const tree = buildLibraryTree([
      doc({ id: 'b', kind: 'page', title: 'Beta', sort_order: 0 }),
      doc({ id: 'a', kind: 'page', title: 'Alpha', sort_order: 1 }),
      doc({ id: 'c', kind: 'page', title: 'Aardvark', sort_order: 0 }),
    ])
    expect(tree.map((t) => t.label)).toEqual(['Aardvark', 'Beta', 'Alpha'])
  })

  it('keeps an empty folder, which is the point of storing folders as rows', () => {
    const tree = buildLibraryTree([doc({ id: 'f', kind: 'folder', title: 'Empty' })])
    expect(tree[0].children).toEqual([])
  })

  it('does not recurse forever on a cycle', () => {
    const tree = buildLibraryTree([
      doc({ id: 'a', kind: 'folder', title: 'A', parent_id: 'b' }),
      doc({ id: 'b', kind: 'folder', title: 'B', parent_id: 'a' }),
    ])
    expect(tree).toEqual([])
  })
})

// ── filtering ───────────────────────────────────────────────────────────────

describe('filterTree', () => {
  const tree = buildLibraryTree([
    doc({ id: 'f', kind: 'folder', title: 'Runbooks' }),
    doc({ id: 'p', kind: 'page', title: 'Reboot the NAS', parent_id: 'f' }),
    doc({ id: 'o', kind: 'page', title: 'VLAN plan' }),
  ])

  it('keeps the folder that leads to a match', () => {
    const filtered = filterTree(tree, 'reboot')
    expect(filtered).toHaveLength(1)
    expect(filtered[0].label).toBe('Runbooks')
    expect(filtered[0].children?.[0].label).toBe('Reboot the NAS')
  })

  it('is case-insensitive and returns everything for an empty query', () => {
    expect(filterTree(tree, 'VLAN')).toHaveLength(1)
    expect(filterTree(tree, '  ')).toEqual(tree)
  })

  it('returns nothing when nothing matches', () => {
    expect(filterTree(tree, 'zzz')).toEqual([])
  })
})

describe('filterGroups', () => {
  const groups = buildDeviceTree({
    groupBy: 'flat',
    devices: [device({ id: 'a', label: 'nas-01' }), device({ id: 'b', label: 'switch-core' })],
    docs: [],
    context: emptyContext,
  })

  it('narrows a group to its matching items', () => {
    expect(filterGroups(groups, 'nas')[0].items.map((i) => i.label)).toEqual(['nas-01'])
  })

  it('keeps every item when the group name itself matches', () => {
    expect(filterGroups(groups, 'All devices')[0].items).toHaveLength(2)
  })

  it('drops a group that ends up empty', () => {
    expect(filterGroups(groups, 'zzz')).toEqual([])
  })
})

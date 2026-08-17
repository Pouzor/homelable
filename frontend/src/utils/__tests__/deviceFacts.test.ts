/**
 * A node carries a copy of its inventory row's facts, hydrated on load. Telling
 * "this canvas edited it" apart from "the row moved on since" needs the values
 * the canvas was given — that baseline is what these functions keep.
 */
import { describe, it, expect } from 'vitest'
import {
  DEVICE_FACT_FIELDS,
  changedFactFields,
  deviceFactsToNodeData,
  factsBaselineOf,
  factsBaselines,
} from '@/utils/deviceFacts'
import type { InventoryEntry, NodeData } from '@/types'
import type { Node } from '@xyflow/react'

const data = (over: Partial<NodeData> = {}): NodeData => ({
  label: 'NAS',
  type: 'nas',
  status: 'online',
  services: [],
  ip: '10.0.0.5',
  notes: 'in the garage',
  ...over,
})

describe('changedFactFields', () => {
  it('reports nothing when the node still holds what it was given', () => {
    const base = factsBaselineOf(data())
    expect(changedFactFields(data(), base)).toEqual([])
  })

  it('reports only the edited field', () => {
    const base = factsBaselineOf(data())
    expect(changedFactFields(data({ notes: 'moved to the loft' }), base)).toEqual(['notes'])
  })

  it('ignores live status — the checker owns reachability, not a canvas', () => {
    const base = factsBaselineOf(data())
    expect(changedFactFields(data({ status: 'offline' }), base)).toEqual([])
    expect(DEVICE_FACT_FIELDS).not.toContain('status')
  })

  it('compares lists by value, not identity', () => {
    const props = [{ key: 'Rack', value: 'A1', icon: null, visible: true }]
    const base = factsBaselineOf(data({ properties: props }))
    expect(changedFactFields(data({ properties: [...props] }), base)).toEqual([])
    expect(changedFactFields(data({ properties: [] }), base)).toEqual(['properties'])
  })

  it('does not call hiding a service an edit to the device', () => {
    const services = [
      { port: 22, protocol: 'tcp' as const, service_name: 'ssh' },
      { port: 3001, protocol: 'tcp' as const, service_name: 'Uptime Kuma' },
    ]
    const base = factsBaselineOf(data({ services }))
    const hidden = [services[0], { ...services[1], visible: false }]
    // Visibility belongs to this node — pushing it as a device edit would hide
    // the service on every other canvas drawing the same row.
    expect(changedFactFields(data({ services: hidden }), base)).toEqual([])
  })

  it('does not call reordering an edit to the device', () => {
    const props = [
      { key: 'Rack', value: 'A1', icon: null, visible: true },
      { key: 'Owner', value: 'me', icon: null, visible: true },
    ]
    const base = factsBaselineOf(data({ properties: props }))
    expect(changedFactFields(data({ properties: [props[1], props[0]] }), base)).toEqual([])
  })

  it('still reports a real edit to a list item', () => {
    const props = [{ key: 'Rack', value: 'A1', icon: null, visible: true }]
    const base = factsBaselineOf(data({ properties: props }))
    expect(changedFactFields(data({ properties: [{ ...props[0], value: 'B2' }] }), base)).toEqual([
      'properties',
    ])
  })

  it('treats every fact as changed with no baseline — a new node has nothing to revert', () => {
    expect(changedFactFields(data(), undefined)).toEqual([...DEVICE_FACT_FIELDS])
  })
})

describe('factsBaselines', () => {
  it('keys one baseline per node', () => {
    const nodes = [
      { id: 'n1', position: { x: 0, y: 0 }, data: data() },
      { id: 'n2', position: { x: 0, y: 0 }, data: data({ notes: 'rack B' }) },
    ] as Node<NodeData>[]
    const baselines = factsBaselines(nodes)
    expect(Object.keys(baselines)).toEqual(['n1', 'n2'])
    expect(changedFactFields(nodes[1].data, baselines.n2)).toEqual([])
    expect(changedFactFields(nodes[1].data, baselines.n1)).toEqual(['notes'])
  })
})

describe('deviceFactsToNodeData', () => {
  const row = (over: Partial<InventoryEntry> = {}): InventoryEntry => ({
    id: 'd-1',
    ip: '10.0.0.5',
    mac: null,
    hostname: 'nas.lan',
    os: null,
    services: [],
    suggested_type: null,
    status: 'approved',
    discovered_at: '2026-01-01T00:00:00Z',
    ...over,
  })

  it('carries the curated facts a node draws', () => {
    const out = deviceFactsToNodeData(row({ label: 'Big NAS', type: 'nas', notes: 'loft' }))
    expect(out.label).toBe('Big NAS')
    expect(out.type).toBe('nas')
    expect(out.notes).toBe('loft')
    expect(out.ip).toBe('10.0.0.5')
  })

  it('leaves the inventory lifecycle out — it is not node data', () => {
    expect(deviceFactsToNodeData(row()).status).toBeUndefined()
  })

  it('falls back through the same name precedence the inventory shows', () => {
    expect(deviceFactsToNodeData(row({ friendly_name: 'Nas box' })).label).toBe('Nas box')
    expect(deviceFactsToNodeData(row()).label).toBe('nas.lan')
  })
})

import { describe, it, expect } from 'vitest'
import { exportCanvasToYaml } from '../exportYaml'
import type { Node, Edge } from '@xyflow/react'
import type { NodeData, EdgeData } from '@/types'
import yaml from 'js-yaml'

const makeNode = (overrides: Partial<NodeData> = {}, id = '1', parentId?: string): Node<NodeData> => ({
  id,
  type: overrides.type ?? 'server',
  position: { x: 0, y: 0 },
  parentId,
  data: { label: 'Test', type: 'server', status: 'online', services: [], ...overrides },
})

const makeEdge = (id: string, source: string, target: string, data: Partial<EdgeData> = {}): Edge<EdgeData> => ({
  id,
  source,
  target,
  data: { type: 'ethernet', ...data } as EdgeData,
})

describe('exportCanvasToYaml', () => {
  it('serializes a simple node with basic fields', () => {
    const nodes = [makeNode({ label: 'My Server', type: 'server', ip: '192.168.1.10', hostname: 'srv.local' })]
    const result = yaml.load(exportCanvasToYaml(nodes, [])) as object[]
    expect(result).toHaveLength(1)
    const entry = result[0] as Record<string, unknown>
    expect(entry.nodeType).toBe('server')
    expect(entry.label).toBe('My Server')
    expect(entry.ipAddress).toBe('192.168.1.10')
    expect(entry.hostname).toBe('srv.local')
  })

  it('omits empty/null/undefined optional fields', () => {
    const nodes = [makeNode({ label: 'Router', type: 'router', hostname: undefined, ip: undefined, notes: undefined })]
    const result = yaml.load(exportCanvasToYaml(nodes, [])) as object[]
    const entry = result[0] as Record<string, unknown>
    expect(entry).not.toHaveProperty('hostname')
    expect(entry).not.toHaveProperty('ipAddress')
    expect(entry).not.toHaveProperty('notes')
  })

  it('omits hardware specs when zero or falsy', () => {
    const nodes = [makeNode({ label: 'Server', type: 'server', cpu_count: 0, ram_gb: 0, disk_gb: 0 })]
    const result = yaml.load(exportCanvasToYaml(nodes, [])) as object[]
    const entry = result[0] as Record<string, unknown>
    expect(entry).not.toHaveProperty('cpuCore')
    expect(entry).not.toHaveProperty('ram')
    expect(entry).not.toHaveProperty('disk')
  })

  it('includes hardware specs when non-zero', () => {
    const nodes = [makeNode({ label: 'Server', type: 'server', cpu_count: 16, ram_gb: 64, disk_gb: 2000, cpu_model: 'Intel Xeon' })]
    const result = yaml.load(exportCanvasToYaml(nodes, [])) as object[]
    const entry = result[0] as Record<string, unknown>
    expect(entry.cpuCore).toBe(16)
    expect(entry.ram).toBe(64)
    expect(entry.disk).toBe(2000)
    expect(entry.cpuModel).toBe('Intel Xeon')
  })

  it('serializes parent relationship from parentId', () => {
    const parent = makeNode({ label: 'Proxmox1', type: 'proxmox' }, 'pve1')
    const child = makeNode({ label: 'VM1', type: 'vm' }, 'vm1', 'pve1')
    const edge = makeEdge('e1', 'pve1', 'vm1', { type: 'virtual' })
    const result = yaml.load(exportCanvasToYaml([parent, child], [edge])) as object[]
    const childEntry = (result as Record<string, unknown>[]).find((e) => e.label === 'VM1')!
    expect(childEntry.parent).toEqual({ label: 'Proxmox1', linkType: 'virtual', linkLabel: '' })
  })

  it('serializes cluster-type edge as clusterR on source node', () => {
    const nodeA = makeNode({ label: 'PVE1', type: 'proxmox' }, 'a')
    const nodeB = makeNode({ label: 'PVE2', type: 'proxmox' }, 'b')
    const edge = makeEdge('e1', 'a', 'b', { type: 'cluster', label: '10GbE' })
    const result = yaml.load(exportCanvasToYaml([nodeA, nodeB], [edge])) as Record<string, unknown>[]
    const entryA = result.find((e) => e.label === 'PVE1')!
    expect(entryA.clusterR).toEqual({ label: 'PVE2', linkType: 'cluster', linkLabel: '10GbE' })
    expect(entryA).not.toHaveProperty('links')
  })

  it('serializes cluster-type incoming edge as clusterL on target node', () => {
    const nodeA = makeNode({ label: 'PVE1', type: 'proxmox' }, 'a')
    const nodeB = makeNode({ label: 'PVE2', type: 'proxmox' }, 'b')
    const edge = makeEdge('e1', 'a', 'b', { type: 'cluster' })
    const result = yaml.load(exportCanvasToYaml([nodeA, nodeB], [edge])) as Record<string, unknown>[]
    const entryA = result.find((e) => e.label === 'PVE1')!
    const entryB = result.find((e) => e.label === 'PVE2')!
    // edge serialized as clusterR on A — should NOT also appear as clusterL on B
    expect(entryA.clusterR).toBeDefined()
    expect(entryB).not.toHaveProperty('clusterL')
  })

  it('serializes regular ethernet edge in links array on source node', () => {
    const nodeA = makeNode({ label: 'Switch', type: 'switch' }, 'sw')
    const nodeB = makeNode({ label: 'Server1', type: 'server' }, 's1')
    const edge = makeEdge('e1', 'sw', 's1', { type: 'ethernet', label: 'eth0' })
    const result = yaml.load(exportCanvasToYaml([nodeA, nodeB], [edge])) as Record<string, unknown>[]
    const entryA = result.find((e) => e.label === 'Switch')!
    const entryB = result.find((e) => e.label === 'Server1')!
    expect(entryA.links).toEqual([{ label: 'Server1', linkType: 'ethernet', linkLabel: 'eth0' }])
    expect(entryB).not.toHaveProperty('links')
    expect(entryA).not.toHaveProperty('clusterR')
  })

  it('serializes a fibre edge with linkType "fibre" (issue #21)', () => {
    const nodeA = makeNode({ label: 'Switch', type: 'switch' }, 'sw')
    const nodeB = makeNode({ label: 'Server1', type: 'server' }, 's1')
    const edge = makeEdge('e1', 'sw', 's1', { type: 'fibre', label: 'sfp0' })
    const result = yaml.load(exportCanvasToYaml([nodeA, nodeB], [edge])) as Record<string, unknown>[]
    const entryA = result.find((e) => e.label === 'Switch')!
    expect(entryA.links).toEqual([{ label: 'Server1', linkType: 'fibre', linkLabel: 'sfp0' }])
  })

  it('serializes multiple outgoing edges as links array', () => {
    const sw = makeNode({ label: 'Switch', type: 'switch' }, 'sw')
    const s1 = makeNode({ label: 'Server1', type: 'server' }, 's1')
    const s2 = makeNode({ label: 'Server2', type: 'server' }, 's2')
    const s3 = makeNode({ label: 'Server3', type: 'server' }, 's3')
    const edges = [
      makeEdge('e1', 'sw', 's1', { type: 'ethernet' }),
      makeEdge('e2', 'sw', 's2', { type: 'ethernet' }),
      makeEdge('e3', 'sw', 's3', { type: 'wifi' }),
    ]
    const result = yaml.load(exportCanvasToYaml([sw, s1, s2, s3], edges)) as Record<string, unknown>[]
    const swEntry = result.find((e) => e.label === 'Switch')!
    const links = swEntry.links as Record<string, unknown>[]
    expect(links).toHaveLength(3)
    expect(links.map((l) => l.label)).toEqual(expect.arrayContaining(['Server1', 'Server2', 'Server3']))
    // Servers should have no links (edges are on source side)
    for (const label of ['Server1', 'Server2', 'Server3']) {
      const entry = result.find((e) => e.label === label)!
      expect(entry).not.toHaveProperty('links')
    }
  })

  it('does not duplicate a links edge on the target node', () => {
    const nodeA = makeNode({ label: 'NodeA', type: 'server' }, 'a')
    const nodeB = makeNode({ label: 'NodeB', type: 'server' }, 'b')
    const edge = makeEdge('e1', 'a', 'b', { type: 'ethernet' })
    const result = yaml.load(exportCanvasToYaml([nodeA, nodeB], [edge])) as Record<string, unknown>[]
    const entryA = result.find((e) => e.label === 'NodeA')!
    const entryB = result.find((e) => e.label === 'NodeB')!
    expect(entryA.links).toHaveLength(1)
    expect(entryB).not.toHaveProperty('links')
  })

  it('excludes groupRect nodes from output', () => {
    const nodes = [
      makeNode({ label: 'Zone', type: 'groupRect' }, '1'),
      makeNode({ label: 'Server', type: 'server' }, '2'),
    ]
    const result = yaml.load(exportCanvasToYaml(nodes, [])) as object[]
    expect(result).toHaveLength(1)
    expect((result[0] as Record<string, unknown>).label).toBe('Server')
  })

  it('roundtrip: all non-empty fields appear in YAML output', () => {
    const nodes = [makeNode({
      label: 'Full Node',
      type: 'server',
      ip: '10.0.0.1',
      hostname: 'full.local',
      check_method: 'ping',
      check_target: '10.0.0.1',
      notes: 'test notes',
      cpu_model: 'AMD EPYC',
      cpu_count: 32,
      ram_gb: 128,
      disk_gb: 4000,
      custom_icon: 'star',
    })]
    const yamlStr = exportCanvasToYaml(nodes, [])
    expect(yamlStr).toContain('Full Node')
    expect(yamlStr).toContain('10.0.0.1')
    expect(yamlStr).toContain('full.local')
    expect(yamlStr).toContain('ping')
    expect(yamlStr).toContain('test notes')
    expect(yamlStr).toContain('AMD EPYC')
    expect(yamlStr).toContain('32')
    expect(yamlStr).toContain('128')
    expect(yamlStr).toContain('4000')
    expect(yamlStr).toContain('star')
  })
})

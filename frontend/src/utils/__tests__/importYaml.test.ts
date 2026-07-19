import { describe, it, expect, vi, beforeEach } from 'vitest'
import { parseYamlToCanvas } from '../importYaml'
import { exportCanvasToYaml } from '../exportYaml'
import type { Node, Edge } from '@xyflow/react'
import type { NodeData, EdgeData } from '@/types'

// Mock dagre layout to return nodes with predictable positions
vi.mock('../layout', () => ({
  applyDagreLayout: (nodes: Node<NodeData>[]) =>
    nodes.map((n, i) => ({ ...n, position: { x: i * 200, y: 0 } })),
}))

// Mock uuid to return deterministic ids
let uuidCounter = 0
vi.mock('../uuid', () => ({
  generateUUID: () => `test-uuid-${++uuidCounter}`,
}))

beforeEach(() => {
  uuidCounter = 0
})

const empty: Node<NodeData>[] = []
const emptyEdges: Edge<EdgeData>[] = []

describe('parseYamlToCanvas', () => {
  it('parses a minimal node (only nodeType + label)', () => {
    const yaml = `
- nodeType: server
  label: "My Server"
`
    const { nodes, edges, imported } = parseYamlToCanvas(yaml, empty, emptyEdges)
    expect(imported).toBe(1)
    expect(nodes).toHaveLength(1)
    expect(nodes[0].data.label).toBe('My Server')
    expect(nodes[0].data.type).toBe('server')
    expect(nodes[0].data.status).toBe('unknown')
    expect(edges).toHaveLength(0)
  })

  it('parses all scalar fields', () => {
    const yaml = `
- nodeType: proxmox
  label: "PVE1"
  hostname: "pve1.local"
  ipAddress: "192.168.1.10"
  checkMethod: ping
  checkTarget: "192.168.1.10"
  notes: "main host"
  nodeIcon: "custom-icon"
  cpuModel: "Intel Xeon"
  cpuCore: 16
  ram: 64
  disk: 2000
`
    const { nodes } = parseYamlToCanvas(yaml, empty, emptyEdges)
    const d = nodes[0].data
    expect(d.hostname).toBe('pve1.local')
    expect(d.ip).toBe('192.168.1.10')
    expect(d.check_method).toBe('ping')
    expect(d.check_target).toBe('192.168.1.10')
    expect(d.notes).toBe('main host')
    expect(d.custom_icon).toBe('custom-icon')
    expect(d.cpu_model).toBe('Intel Xeon')
    expect(d.cpu_count).toBe(16)
    expect(d.ram_gb).toBe(64)
    expect(d.disk_gb).toBe(2000)
    expect(d.show_hardware).toBe(true)
  })

  it('sets show_hardware only when hardware fields present', () => {
    const yaml = `- nodeType: server\n  label: "NoHW"\n`
    const { nodes } = parseYamlToCanvas(yaml, empty, emptyEdges)
    expect(nodes[0].data.show_hardware).toBeUndefined()
  })

  it('links edges have bottom→top-t handles', () => {
    const yaml = `
- nodeType: switch
  label: "SW"
  links:
    - label: "SRV"
      linkType: ethernet
- nodeType: server
  label: "SRV"
`
    const { edges } = parseYamlToCanvas(yaml, empty, emptyEdges)
    expect(edges).toHaveLength(1)
    expect(edges[0].sourceHandle).toBe('bottom')
    expect(edges[0].targetHandle).toBe('top-t')
  })

  it('imports a fibre link type onto the edge (issue #21)', () => {
    const yaml = `
- nodeType: switch
  label: "SW"
  links:
    - label: "SRV"
      linkType: fibre
- nodeType: server
  label: "SRV"
`
    const { edges } = parseYamlToCanvas(yaml, empty, emptyEdges)
    expect(edges).toHaveLength(1)
    expect(edges[0].type).toBe('fibre')
    expect(edges[0].data?.type).toBe('fibre')
  })

  it('cluster edges are remapped onto right→left connection points (#243)', () => {
    const yaml = `
- nodeType: proxmox
  label: "PVE1"
  clusterR:
    label: "PVE2"
    linkType: ethernet
- nodeType: proxmox
  label: "PVE2"
`
    const { nodes, edges } = parseYamlToCanvas(yaml, empty, emptyEdges)
    expect(edges).toHaveLength(1)
    expect(edges[0].sourceHandle).toBe('right')
    expect(edges[0].targetHandle).toBe('left')
    // Connected sides get a connection point so the link is anchored.
    const src = nodes.find((n) => n.id === edges[0].source)!
    const tgt = nodes.find((n) => n.id === edges[0].target)!
    expect(src.data.right_handles).toBe(1)
    expect(tgt.data.left_handles).toBe(1)
  })

  it('parent relationship sets parentId and creates an edge', () => {
    const yaml = `
- nodeType: proxmox
  label: "PVE1"
- nodeType: vm
  label: "VM1"
  parent:
    label: "PVE1"
    linkType: virtual
    linkLabel: "hosted"
`
    const { nodes, edges } = parseYamlToCanvas(yaml, empty, emptyEdges)
    const vm = nodes.find((n) => n.data.label === 'VM1')!
    const pve = nodes.find((n) => n.data.label === 'PVE1')!
    expect(vm.parentId).toBe(pve.id)
    expect(vm.data.parent_id).toBe(pve.id)
    expect(vm.extent).toBe('parent')
    expect(edges).toHaveLength(1)
    expect(edges[0].source).toBe(pve.id)
    expect(edges[0].target).toBe(vm.id)
    expect(edges[0].type).toBe('virtual')
    expect(edges[0].data?.label).toBe('hosted')
  })

  it('clusterR creates an edge from this node to target', () => {
    const yaml = `
- nodeType: proxmox
  label: "PVE1"
  clusterR:
    label: "PVE2"
    linkType: ethernet
    linkLabel: "10GbE"
- nodeType: proxmox
  label: "PVE2"
`
    const { nodes, edges } = parseYamlToCanvas(yaml, empty, emptyEdges)
    const pve1 = nodes.find((n) => n.data.label === 'PVE1')!
    const pve2 = nodes.find((n) => n.data.label === 'PVE2')!
    expect(edges).toHaveLength(1)
    expect(edges[0].source).toBe(pve1.id)
    expect(edges[0].target).toBe(pve2.id)
    expect(edges[0].type).toBe('ethernet')
  })

  it('clusterL creates an edge from referenced node to this node', () => {
    const yaml = `
- nodeType: proxmox
  label: "PVE1"
- nodeType: proxmox
  label: "PVE2"
  clusterL:
    label: "PVE1"
    linkType: cluster
    linkLabel: ""
`
    const { nodes, edges } = parseYamlToCanvas(yaml, empty, emptyEdges)
    const pve1 = nodes.find((n) => n.data.label === 'PVE1')!
    const pve2 = nodes.find((n) => n.data.label === 'PVE2')!
    expect(edges).toHaveLength(1)
    expect(edges[0].source).toBe(pve1.id)
    expect(edges[0].target).toBe(pve2.id)
  })

  it('links array creates multiple edges from this node', () => {
    const yaml = `
- nodeType: switch
  label: "Switch"
  links:
    - label: "Server1"
      linkType: ethernet
    - label: "Server2"
      linkType: ethernet
    - label: "Server3"
      linkType: wifi
- nodeType: server
  label: "Server1"
- nodeType: server
  label: "Server2"
- nodeType: server
  label: "Server3"
`
    const { nodes, edges } = parseYamlToCanvas(yaml, empty, emptyEdges)
    const sw = nodes.find((n) => n.data.label === 'Switch')!
    expect(edges).toHaveLength(3)
    expect(edges.every((e) => e.source === sw.id)).toBe(true)
    const targets = edges.map((e) => nodes.find((n) => n.id === e.target)!.data.label)
    expect(targets).toEqual(expect.arrayContaining(['Server1', 'Server2', 'Server3']))
  })

  it('deduplicates edges when clusterR on A and clusterL on B point to each other', () => {
    const yaml = `
- nodeType: proxmox
  label: "PVE1"
  clusterR:
    label: "PVE2"
    linkType: ethernet
- nodeType: proxmox
  label: "PVE2"
  clusterL:
    label: "PVE1"
    linkType: ethernet
`
    const { edges } = parseYamlToCanvas(yaml, empty, emptyEdges)
    expect(edges).toHaveLength(1)
  })

  it('skips nodes with same label as existing canvas nodes', () => {
    const existing: Node<NodeData>[] = [{
      id: 'existing-1',
      type: 'server',
      position: { x: 0, y: 0 },
      data: { label: 'ExistingServer', type: 'server', status: 'online', services: [] },
    }]
    const yaml = `
- nodeType: server
  label: "ExistingServer"
- nodeType: router
  label: "NewRouter"
`
    const { nodes, imported } = parseYamlToCanvas(yaml, existing, emptyEdges)
    expect(imported).toBe(1)
    expect(nodes.filter((n) => n.data.label === 'ExistingServer')).toHaveLength(1)
    expect(nodes.filter((n) => n.data.label === 'NewRouter')).toHaveLength(1)
  })

  it('merges with existing edges without duplicating', () => {
    const existing: Node<NodeData>[] = [
      { id: 'a', type: 'server', position: { x: 0, y: 0 }, data: { label: 'A', type: 'server', status: 'online', services: [] } },
      { id: 'b', type: 'server', position: { x: 0, y: 0 }, data: { label: 'B', type: 'server', status: 'online', services: [] } },
    ]
    const existingEdge: Edge<EdgeData>[] = [{
      id: 'e1', source: 'a', target: 'b', type: 'ethernet',
      data: { type: 'ethernet' },
    }]
    const yaml = `
- nodeType: server
  label: "A"
  clusterR:
    label: "B"
    linkType: ethernet
`
    // A already exists so it's skipped, no new edge created
    const { edges } = parseYamlToCanvas(yaml, existing, existingEdge)
    expect(edges).toHaveLength(1)
  })

  it('throws on invalid YAML', () => {
    expect(() => parseYamlToCanvas('{invalid: [yaml', empty, emptyEdges)).toThrow()
  })

  it('throws when YAML is not an array', () => {
    const yaml = `nodeType: server\nlabel: oops\n`
    expect(() => parseYamlToCanvas(yaml, empty, emptyEdges)).toThrow(/list/)
  })

  it('throws when nodeType is missing', () => {
    const yaml = `- label: "Missing type"\n`
    expect(() => parseYamlToCanvas(yaml, empty, emptyEdges)).toThrow(/nodeType/)
  })

  it('throws when label is missing', () => {
    const yaml = `- nodeType: server\n`
    expect(() => parseYamlToCanvas(yaml, empty, emptyEdges)).toThrow(/label/)
  })

  it('warns and skips unknown parent label without crashing', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const yaml = `
- nodeType: vm
  label: "OrphanVM"
  parent:
    label: "NonexistentHost"
    linkType: virtual
`
    const { nodes, edges } = parseYamlToCanvas(yaml, empty, emptyEdges)
    expect(nodes).toHaveLength(1)
    expect(edges).toHaveLength(0)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('NonexistentHost'))
    warnSpy.mockRestore()
  })

  // Regression for issue #208.
  it('restores edge connection points from the YAML link', () => {
    const yaml = `
- nodeType: switch
  label: "Switch"
  bottomHandles: 3
  links:
    - label: "Server1"
      linkType: ethernet
      sourceHandle: bottom-3
      targetHandle: top-2-t
- nodeType: server
  label: "Server1"
`
    const { nodes, edges } = parseYamlToCanvas(yaml, empty, emptyEdges)
    expect(edges).toHaveLength(1)
    expect(edges[0].sourceHandle).toBe('bottom-3')
    expect(edges[0].targetHandle).toBe('top-2-t')
    const sw = nodes.find((n) => n.data.label === 'Switch')!
    expect(sw.data.bottom_handles).toBe(3)
  })

  it('falls back to legacy handles when the YAML link omits them', () => {
    const yaml = `
- nodeType: switch
  label: "Switch"
  links:
    - label: "Server1"
      linkType: ethernet
- nodeType: server
  label: "Server1"
`
    const { edges } = parseYamlToCanvas(yaml, empty, emptyEdges)
    expect(edges[0].sourceHandle).toBe('bottom')
    expect(edges[0].targetHandle).toBe('top-t')
  })

  it('round-trips connection points through export → import (issue #208)', () => {
    const sw: Node<NodeData> = {
      id: 'sw', type: 'switch', position: { x: 0, y: 0 },
      data: { label: 'Switch', type: 'switch', status: 'online', services: [], bottom_handles: 3 },
    }
    const s1: Node<NodeData> = {
      id: 's1', type: 'server', position: { x: 0, y: 0 },
      data: { label: 'Server1', type: 'server', status: 'online', services: [] },
    }
    const edge: Edge<EdgeData> = {
      id: 'e1', source: 'sw', target: 's1',
      sourceHandle: 'bottom-3', targetHandle: 'top-t',
      data: { type: 'ethernet' } as EdgeData,
    }

    const yamlStr = exportCanvasToYaml([sw, s1], [edge])
    const { nodes, edges } = parseYamlToCanvas(yamlStr, empty, emptyEdges)

    expect(edges).toHaveLength(1)
    expect(edges[0].sourceHandle).toBe('bottom-3')
    expect(edges[0].targetHandle).toBe('top-t')
    expect(nodes.find((n) => n.data.label === 'Switch')!.data.bottom_handles).toBe(3)
  })

  // Regression for issue #272.
  it('restores the show-port-numbers toggle from YAML', () => {
    const yaml = `
- nodeType: server
  label: "Server"
  showPortNumbers: true
`
    const { nodes } = parseYamlToCanvas(yaml, empty, emptyEdges)
    expect(nodes.find((n) => n.data.label === 'Server')!.data.show_port_numbers).toBe(true)
  })

  it('round-trips show-port-numbers through export → import (issue #272)', () => {
    const on: Node<NodeData> = {
      id: 'on', type: 'server', position: { x: 0, y: 0 },
      data: { label: 'On', type: 'server', status: 'online', services: [], show_port_numbers: true },
    }
    const off: Node<NodeData> = {
      id: 'off', type: 'server', position: { x: 0, y: 0 },
      data: { label: 'Off', type: 'server', status: 'online', services: [] },
    }
    const yamlStr = exportCanvasToYaml([on, off], [])
    const { nodes } = parseYamlToCanvas(yamlStr, empty, emptyEdges)
    expect(nodes.find((n) => n.data.label === 'On')!.data.show_port_numbers).toBe(true)
    expect(nodes.find((n) => n.data.label === 'Off')!.data.show_port_numbers).toBeUndefined()
  })
})

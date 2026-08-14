/**
 * Standalone keeps the same split as the API: one inventory row per device, a
 * node holding only the id of the row it draws. The blob carries both, and a
 * load puts the facts back on the nodes so the canvas renders unchanged.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import type { Node } from '@xyflow/react'
import type { NodeData } from '@/types'
import { saveCanvas, loadCanvas, ensureSeed, type StandaloneCanvas } from '@/utils/standaloneStorage'

function node(id: string, data: Partial<NodeData> = {}): Node<NodeData> {
  return {
    id,
    type: data.type ?? 'server',
    position: { x: 0, y: 0 },
    data: { label: id, type: 'server', status: 'unknown', services: [], ...data },
  }
}

function stored(designId: string): StandaloneCanvas {
  return JSON.parse(localStorage.getItem(`homelable_canvas:${designId}`) as string)
}

beforeEach(() => localStorage.clear())

describe('standalone device rows', () => {
  it('moves the device facts off the node and into a row', () => {
    saveCanvas('d1', {
      nodes: [node('n1', { ip: '10.0.0.5', services: [{ port: 22, protocol: 'tcp', service_name: 'ssh' }] })],
      edges: [],
    })

    const blob = stored('d1')
    expect(blob.devices).toHaveLength(1)
    const [device] = blob.devices!
    expect(device.ip).toBe('10.0.0.5')
    expect(device.services).toHaveLength(1)
    expect(blob.nodes[0].data.device_id).toBe(device.id)
  })

  it('puts them back on load', () => {
    saveCanvas('d1', { nodes: [node('n1', { ip: '10.0.0.5', notes: 'garage' })], edges: [] })

    const loaded = loadCanvas('d1')
    expect(loaded?.nodes[0].data.ip).toBe('10.0.0.5')
    expect(loaded?.nodes[0].data.notes).toBe('garage')
  })

  it('keeps one row for a device drawn twice', () => {
    saveCanvas('d1', { nodes: [node('n1', { ip: '10.0.0.5' })], edges: [] })
    const loaded = loadCanvas('d1')!
    // Same device placed again on this canvas, pointing at the same row.
    const deviceId = loaded.nodes[0].data.device_id
    saveCanvas('d1', {
      ...loaded,
      nodes: [...loaded.nodes, node('n2', { ip: '10.0.0.5', device_id: deviceId })],
    })

    const blob = stored('d1')
    expect(blob.devices).toHaveLength(1)
    expect(blob.nodes.map((n) => n.data.device_id)).toEqual([deviceId, deviceId])
  })

  it('propagates an edit to every node drawing that device', () => {
    saveCanvas('d1', { nodes: [node('n1', { ip: '10.0.0.5' })], edges: [] })
    const loaded = loadCanvas('d1')!
    const deviceId = loaded.nodes[0].data.device_id as string
    saveCanvas('d1', {
      ...loaded,
      nodes: [
        { ...loaded.nodes[0], data: { ...loaded.nodes[0].data, ip: '10.0.0.9' } },
        node('n2', { ip: '10.0.0.5', device_id: deviceId }),
      ],
    })

    // n2 was saved with the stale address; the row holds the last write and both
    // nodes read it back.
    const reloaded = loadCanvas('d1')!
    expect(stored('d1').devices).toHaveLength(1)
    expect(reloaded.nodes.every((n) => n.data.ip === reloaded.nodes[0].data.ip)).toBe(true)
  })

  it('stores reachability as status_live, never as the lifecycle status', () => {
    saveCanvas('d1', { nodes: [node('n1', { ip: '10.0.0.5', status: 'online' })], edges: [] })

    const [device] = stored('d1').devices!
    // `status` is pending / approved / hidden — a device on a canvas is approved.
    expect(device.status).toBe('approved')
    expect(device.status_live).toBe('online')
  })

  it('puts reachability back on the node it belongs to', () => {
    saveCanvas('d1', { nodes: [node('n1', { ip: '10.0.0.5', status: 'offline' })], edges: [] })
    expect(loadCanvas('d1')?.nodes[0].data.status).toBe('offline')
  })

  it('repairs a row saved with reachability in the lifecycle field', () => {
    // Written by the version that copied `status` straight across.
    localStorage.setItem(
      'homelable_canvas:d1',
      JSON.stringify({
        nodes: [{ ...node('n1'), data: { ...node('n1').data, device_id: 'dev-1' } }],
        edges: [],
        devices: [
          { id: 'dev-1', ip: '10.0.0.5', status: 'online', discovered_at: '2026-01-01T00:00:00Z' },
        ],
      }),
    )

    const loaded = loadCanvas('d1')!
    expect(loaded.nodes[0].data.status).toBe('online')
    saveCanvas('d1', loaded)

    const [device] = stored('d1').devices!
    expect(device.status).toBe('approved')
    expect(device.status_live).toBe('online')
  })

  it('gives canvas furniture no row', () => {
    saveCanvas('d1', {
      nodes: [node('z1', { type: 'groupRect', label: 'Zone' }), node('t1', { type: 'text' })],
      edges: [],
    })

    const blob = stored('d1')
    expect(blob.devices).toEqual([])
    expect(blob.nodes.every((n) => n.data.device_id === undefined)).toBe(true)
  })

  it('reads a canvas saved before the split, whose nodes carry the facts inline', () => {
    localStorage.setItem(
      'homelable_canvas:d1',
      JSON.stringify({ nodes: [node('n1', { ip: '10.0.0.7' })], edges: [] }),
    )

    const loaded = loadCanvas('d1')
    expect(loaded?.nodes[0].data.ip).toBe('10.0.0.7')
  })
})

/**
 * An install that predates the split has canvases whose nodes carry the facts
 * inline and no `devices` at all. Reading one must not lose anything, and the
 * next save must convert it in place rather than write the old shape back.
 */
describe('a canvas stored in the pre-split shape', () => {
  const legacyNode = () =>
    node('n1', {
      ip: '10.0.0.7',
      hostname: 'nas.lan',
      notes: 'garage',
      cpu_count: 8,
      show_hardware: true,
      services: [{ port: 22, protocol: 'tcp', service_name: 'ssh' }],
      properties: [{ key: 'Rack', value: 'A1', icon: null, visible: true }],
    })

  it('survives a load-then-save round trip with every fact intact', () => {
    localStorage.setItem(
      'homelable_canvas:d1',
      JSON.stringify({ nodes: [legacyNode()], edges: [], theme_id: 'midnight' }),
    )

    // What the app does on open: load, then save at some point after.
    const loaded = loadCanvas('d1')!
    saveCanvas('d1', loaded)

    const blob = stored('d1')
    expect(blob.devices).toHaveLength(1)
    const [device] = blob.devices!
    expect(device.ip).toBe('10.0.0.7')
    expect(device.hostname).toBe('nas.lan')
    expect(device.notes).toBe('garage')
    expect(device.cpu_count).toBe(8)
    expect(device.show_hardware).toBe(true)
    expect(device.services).toHaveLength(1)
    expect(device.properties).toHaveLength(1)
    expect(blob.nodes[0].data.device_id).toBe(device.id)
    expect(blob.theme_id).toBe('midnight')

    // And it still reads back the same way it did before the conversion.
    const reloaded = loadCanvas('d1')!
    expect(reloaded.nodes[0].data.ip).toBe('10.0.0.7')
    expect(reloaded.nodes[0].data.cpu_count).toBe(8)
    expect(reloaded.nodes[0].data.properties).toHaveLength(1)
  })

  it('does not mint a second row when saved twice', () => {
    localStorage.setItem(
      'homelable_canvas:d1',
      JSON.stringify({ nodes: [legacyNode()], edges: [] }),
    )

    saveCanvas('d1', loadCanvas('d1')!)
    const firstId = stored('d1').devices![0].id
    saveCanvas('d1', loadCanvas('d1')!)

    expect(stored('d1').devices).toHaveLength(1)
    expect(stored('d1').devices![0].id).toBe(firstId)
  })

  it('keeps furniture out of the conversion', () => {
    localStorage.setItem(
      'homelable_canvas:d1',
      JSON.stringify({
        nodes: [legacyNode(), node('z1', { type: 'groupRect', label: 'Zone' })],
        edges: [],
      }),
    )

    saveCanvas('d1', loadCanvas('d1')!)

    const blob = stored('d1')
    expect(blob.devices).toHaveLength(1)
    expect(blob.nodes.find((n) => n.id === 'z1')!.data.device_id).toBeUndefined()
  })

  it('carries a legacy single-canvas install through ensureSeed', () => {
    localStorage.setItem(
      'homelable_canvas',
      JSON.stringify({ nodes: [legacyNode()], edges: [] }),
    )

    const [design] = ensureSeed()
    const loaded = loadCanvas(design.id)!

    expect(loaded.nodes[0].data.ip).toBe('10.0.0.7')
    expect(localStorage.getItem('homelable_canvas')).toBeNull()

    saveCanvas(design.id, loaded)
    expect(stored(design.id).devices).toHaveLength(1)
  })
})

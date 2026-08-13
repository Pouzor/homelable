/**
 * Standalone keeps the same split as the API: one inventory row per device, a
 * node holding only the id of the row it draws. The blob carries both, and a
 * load puts the facts back on the nodes so the canvas renders unchanged.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import type { Node } from '@xyflow/react'
import type { NodeData } from '@/types'
import { saveCanvas, loadCanvas, type StandaloneCanvas } from '@/utils/standaloneStorage'

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

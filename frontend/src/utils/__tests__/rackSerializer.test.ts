import { describe, it, expect } from 'vitest'
import {
  buildSavePayload,
  fromCable,
  fromRack,
  fromRackDevice,
  toCable,
  toInventoryDevice,
  toRack,
  toRackDevice,
  type ApiRack,
  type ApiRackCable,
  type ApiRackDevice,
} from '../rackSerializer'
import { DEFAULT_RACK_STYLE } from '@/rack/rackDefaults'
import type { Cable, Rack, RackDevice } from '@/types'

const apiRack: ApiRack = {
  id: 'r1',
  design_id: 'd1',
  name: 'Main',
  u_height: 24,
  width_standard: '10',
  numbering: 'top-down',
  location: 'garage',
  style: { frame: '#111111', showNumbers: false },
  pos_x: 40,
  pos_y: 60,
}

const apiDevice: ApiRackDevice = {
  id: 'dev1',
  design_id: 'd1',
  rack_id: 'r1',
  device_id: 'inv1',
  node_id: 'node1',
  label: 'sw-24',
  u_start: 10,
  u_height: 1,
  col_start: 0,
  col_span: 12,
  faceplate_id: 'switch-24',
  color: null,
  status: 'online',
  ports: [{ id: 'p1', label: '1', type: 'sfp+', x: 0.4, y: 0.5 }],
}

const apiCable: ApiRackCable = {
  id: 'c1',
  design_id: 'd1',
  from_device_id: 'dev1',
  from_port_id: 'p1',
  to_device_id: 'dev2',
  to_port_id: 'p2',
  type: 'fiber',
  color: '#f0a500',
  label: 'SAN',
}

describe('API → domain', () => {
  it('maps a rack, nesting the position', () => {
    const rack = toRack(apiRack)
    expect(rack).toMatchObject({
      id: 'r1',
      uHeight: 24,
      widthStandard: '10',
      numbering: 'top-down',
      location: 'garage',
      position: { x: 40, y: 60 },
    })
  })

  it('fills style keys the server never wrote', () => {
    const { style } = toRack(apiRack)
    expect(style.frame).toBe('#111111')
    expect(style.showNumbers).toBe(false)
    expect(style.rail).toBe(DEFAULT_RACK_STYLE.rail)
    expect(style.enclosed).toBe(DEFAULT_RACK_STYLE.enclosed)
  })

  it('falls back on unknown enum values rather than trusting the wire', () => {
    const rack = toRack({ ...apiRack, width_standard: '23', numbering: 'sideways' })
    expect(rack.widthStandard).toBe('19')
    expect(rack.numbering).toBe('bottom-up')
  })

  it('maps a device with both inventory and node links', () => {
    const device = toRackDevice(apiDevice)
    expect(device).toMatchObject({
      rackId: 'r1',
      deviceId: 'inv1',
      nodeId: 'node1',
      uStart: 10,
      faceplateId: 'switch-24',
      status: 'online',
    })
    expect(device.ports[0].type).toBe('sfp+')
  })

  it('drops ports that are not usable and defaults unknown port types', () => {
    const device = toRackDevice({
      ...apiDevice,
      ports: [null, { label: 'no id' }, { id: 'p9', type: 'usb', x: 0.1, y: 0.2 }],
    })
    expect(device.ports).toHaveLength(1)
    expect(device.ports[0]).toMatchObject({ id: 'p9', label: 'p9', type: 'rj45' })
  })

  it('treats an unknown device status as unknown', () => {
    expect(toRackDevice({ ...apiDevice, status: 'exploded' }).status).toBe('unknown')
  })

  it('maps a cable into nested endpoints', () => {
    expect(toCable(apiCable)).toMatchObject({
      type: 'fiber',
      label: 'SAN',
      from: { deviceId: 'dev1', portId: 'p1' },
      to: { deviceId: 'dev2', portId: 'p2' },
    })
  })

  it('takes inventory status from the linked node, not the inventory row', () => {
    const item = toInventoryDevice({
      id: 'inv1',
      label: 'nas',
      suggested_type: 'nas',
      ip: '192.168.1.9',
      status: 'approved',
      discovery_source: 'arp',
      node_id: 'node1',
      node_status: 'online',
      racked: false,
    })
    expect(item.status).toBe('online')
    expect(item.nodeId).toBe('node1')
    expect(item.suggestedFaceplateId).toBe('nas-2u')
  })

  it('leaves an inventory entry with no canvas node as unknown', () => {
    const item = toInventoryDevice({
      id: 'inv2',
      label: 'patch panel',
      suggested_type: null,
      ip: null,
      status: 'pending',
      discovery_source: 'manual',
      node_id: null,
      node_status: null,
      racked: true,
    })
    expect(item.status).toBe('unknown')
    expect(item.racked).toBe(true)
  })
})

describe('domain → API', () => {
  it('round-trips a rack', () => {
    expect(fromRack(toRack(apiRack))).toMatchObject({
      id: 'r1',
      u_height: 24,
      width_standard: '10',
      pos_x: 40,
      pos_y: 60,
    })
  })

  it('round-trips a device', () => {
    const back = fromRackDevice(toRackDevice(apiDevice))
    expect(back).toMatchObject({ id: 'dev1', rack_id: 'r1', device_id: 'inv1', u_start: 10 })
  })

  it('round-trips a cable', () => {
    expect(fromCable(toCable(apiCable))).toMatchObject({
      from_device_id: 'dev1',
      to_port_id: 'p2',
      type: 'fiber',
    })
  })

  it('clamps a device back into the column grid', () => {
    const device = { ...toRackDevice(apiDevice), colStart: 99, colSpan: 99 }
    const back = fromRackDevice(device)
    expect(back.col_start).toBe(11)
    expect(back.col_span).toBe(12)
  })
})

describe('buildSavePayload', () => {
  const rack: Rack = toRack(apiRack)
  const device: RackDevice = toRackDevice(apiDevice)
  const viewport = { x: 1, y: 2, zoom: 1.5 }

  it('carries racks, devices, cables and the viewport', () => {
    const other: RackDevice = { ...device, id: 'dev2', ports: [{ id: 'p2', label: '2', type: 'rj45', x: 0.5, y: 0.5 }] }
    const cable: Cable = toCable(apiCable)
    const payload = buildSavePayload('d1', [rack], [device, other], [cable], viewport)
    expect(payload.design_id).toBe('d1')
    expect(payload.devices).toHaveLength(2)
    expect(payload.cables).toHaveLength(1)
    expect(payload.viewport).toEqual(viewport)
  })

  it('drops devices whose rack is gone, and the cables that hung off them', () => {
    const orphan: RackDevice = { ...device, id: 'dev2', rackId: 'gone' }
    const cable: Cable = {
      ...toCable(apiCable),
      to: { deviceId: 'dev2', portId: 'p2' },
    }
    const payload = buildSavePayload('d1', [rack], [device, orphan], [cable], viewport)
    expect(payload.devices.map((d) => d.id)).toEqual(['dev1'])
    // The backend rejects dangling cables, so they must not reach it.
    expect(payload.cables).toEqual([])
  })
})

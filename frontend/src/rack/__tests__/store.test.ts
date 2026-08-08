import { describe, it, expect, beforeEach } from 'vitest'
import { useRackStore } from '../store'
import { getFaceplate } from '../faceplates'
import { RACK_COLUMNS } from '@/types'
import { demoNetworkLinks } from '../demoData'

const store = () => useRackStore.getState()

beforeEach(() => {
  useRackStore.getState().loadDemo()
})

describe('racks', () => {
  it('boots with the demo rack and its mounted gear', () => {
    expect(store().racks).toHaveLength(1)
    expect(store().devices.length).toBeGreaterThan(0)
    expect(store().cables.length).toBeGreaterThan(0)
  })

  it('adds a rack and selects it', () => {
    const id = store().addRack()
    expect(store().racks).toHaveLength(2)
    expect(store().selectedRackId).toBe(id)
  })

  it('deletes a rack with its devices and their cables', () => {
    store().removeRack('rack-main')
    expect(store().racks).toHaveLength(0)
    expect(store().devices).toHaveLength(0)
    expect(store().cables).toHaveLength(0)
  })

  it('patches style without dropping the other style keys', () => {
    store().updateRackStyle('rack-main', { showNumbers: false })
    const style = store().racks[0].style
    expect(style.showNumbers).toBe(false)
    expect(style.frame).toBeTruthy()
  })
})

describe('mounting', () => {
  it('mounts an inventory item using its suggested faceplate', () => {
    const id = store().mountFromInventory('inv-sw8', 'rack-main', { uStart: 5 })
    expect(id).not.toBeNull()
    const device = store().devices.find((d) => d.id === id)!
    expect(device.faceplateId).toBe('switch-8')
    expect(device.deviceId).toBe('inv-sw8')
    expect(device.ports.length).toBe(getFaceplate('switch-8').ports.length)
  })

  it('gives every mounted port a distinct id', () => {
    const id = store().mountFromInventory('inv-sw8', 'rack-main', { uStart: 5 })!
    const ports = store().devices.find((d) => d.id === id)!.ports
    expect(new Set(ports.map((p) => p.id)).size).toBe(ports.length)
  })

  it('slides a drop onto an occupied U to a free one', () => {
    const taken = store().devices.find((d) => d.id === 'dev-sw24')!
    const id = store().mountFromInventory('inv-sw8', 'rack-main', { uStart: taken.uStart })!
    expect(store().devices.find((d) => d.id === id)!.uStart).not.toBe(taken.uStart)
  })

  it('returns null when the rack has no room', () => {
    const rackId = store().addRack({ uHeight: 1 })
    store().mountAccessory('blank-1u', rackId, { uStart: 1 })
    expect(store().mountAccessory('blank-1u', rackId, { uStart: 1 })).toBeNull()
  })

  it('mounts an accessory with no inventory link', () => {
    const id = store().mountAccessory('shelf-1u', 'rack-main', { uStart: 6 })!
    expect(store().devices.find((d) => d.id === id)!.deviceId).toBeNull()
  })

  it('flags the inventory entry as racked once it is mounted', () => {
    expect(store().inventory.find((i) => i.id === 'inv-sw8')!.racked).toBe(false)
    store().mountFromInventory('inv-sw8', 'rack-main', { uStart: 5 })
    expect(store().inventory.find((i) => i.id === 'inv-sw8')!.racked).toBe(true)
  })

  it('clears the racked flag again when the device is unmounted', () => {
    expect(store().inventory.find((i) => i.id === 'inv-pve1')!.racked).toBe(true)
    store().unmountDevice('dev-pve1')
    expect(store().inventory.find((i) => i.id === 'inv-pve1')!.racked).toBe(false)
  })

  it('carries the canvas node link onto the mount', () => {
    const id = store().mountFromInventory('inv-sw8', 'rack-main', { uStart: 5 })!
    expect(store().devices.find((d) => d.id === id)!.nodeId).toBe('node-inv-sw8')
  })

  it('keeps the inventory entry when a device is unmounted', () => {
    const before = store().inventory.length
    store().unmountDevice('dev-pve1')
    expect(store().devices.find((d) => d.id === 'dev-pve1')).toBeUndefined()
    expect(store().inventory).toHaveLength(before)
    expect(store().inventory.some((i) => i.id === 'inv-pve1')).toBe(true)
  })

  it('drops the cables of an unmounted device', () => {
    const had = store().cables.some(
      (c) => c.from.deviceId === 'dev-nas' || c.to.deviceId === 'dev-nas',
    )
    expect(had).toBe(true)
    store().unmountDevice('dev-nas')
    expect(
      store().cables.some((c) => c.from.deviceId === 'dev-nas' || c.to.deviceId === 'dev-nas'),
    ).toBe(false)
  })
})

describe('moving and resizing', () => {
  it('refuses a move onto an occupied slot', () => {
    const target = store().devices.find((d) => d.id === 'dev-sw24')!
    const ok = store().moveDevice('dev-fw', 'rack-main', {
      uStart: target.uStart,
      uHeight: 1,
      colStart: 0,
      colSpan: RACK_COLUMNS,
    })
    expect(ok).toBe(false)
    expect(store().devices.find((d) => d.id === 'dev-fw')!.uStart).toBe(15)
  })

  it('accepts a move onto a free slot', () => {
    const ok = store().moveDevice('dev-fw', 'rack-main', {
      uStart: 5,
      uHeight: 1,
      colStart: 0,
      colSpan: RACK_COLUMNS,
    })
    expect(ok).toBe(true)
    expect(store().devices.find((d) => d.id === 'dev-fw')!.uStart).toBe(5)
  })

  it('refuses a geometry edit no slot in the rack can take', () => {
    // The demo rack's longest free run is 3U (U4-U6), so 5U fits nowhere.
    expect(store().updateDevice('dev-pve1', { uHeight: 5 })).toBe(false)
    expect(store().devices.find((d) => d.id === 'dev-pve1')!.uHeight).toBe(2)
  })

  it('relocates a device that outgrows its own slot', () => {
    // dev-shelf is 1U at U7 with dev-nas right above; growing it to 3U has to
    // slide it down into the free U4-U6 run rather than silently do nothing.
    expect(store().updateDevice('dev-shelf', { uHeight: 3 })).toBe(true)
    const device = store().devices.find((d) => d.id === 'dev-shelf')!
    expect(device.uHeight).toBe(3)
    expect(device.uStart).toBe(5) // nearest fit, keeping its own U7
  })

  it('applies a non-geometry edit even in a tight rack', () => {
    store().updateDevice('dev-pve1', { label: 'renamed' })
    expect(store().devices.find((d) => d.id === 'dev-pve1')!.label).toBe('renamed')
  })

  it('resizes to the new faceplate when it fits', () => {
    store().updateDevice('dev-blank', { label: 'slot' })
    store().applyFaceplate('dev-pve2', 'server-1u')
    const device = store().devices.find((d) => d.id === 'dev-pve2')!
    expect(device.faceplateId).toBe('server-1u')
    expect(device.uHeight).toBe(1)
  })

  it('relocates rather than keep the old height when a taller plate collides', () => {
    // dev-shelf is 1U at U7, hemmed in by dev-nas above. A 2U plate has to land
    // somewhere it fits — keeping it 1U is how the height looked "locked".
    expect(store().applyFaceplate('dev-shelf', 'ups-2u')).toBe(true)
    const device = store().devices.find((d) => d.id === 'dev-shelf')!
    expect(device.faceplateId).toBe('ups-2u')
    expect(device.uHeight).toBe(2)
    expect(device.uStart).not.toBe(7)
  })

  it('changes nothing when no slot in the rack takes the new plate', () => {
    // 4U, and the longest free run is 3U.
    expect(store().applyFaceplate('dev-sw24', 'server-4u-storage')).toBe(false)
    const device = store().devices.find((d) => d.id === 'dev-sw24')!
    expect(device.faceplateId).toBe('switch-24')
    expect(device.uHeight).toBe(1)
  })
})

describe('ports', () => {
  it('adds and removes a port', () => {
    const before = store().devices.find((d) => d.id === 'dev-pve1')!.ports.length
    store().addPort('dev-pve1', { label: 'ipmi', type: 'rj45', x: 0.5, y: 0.5 })
    const ports = store().devices.find((d) => d.id === 'dev-pve1')!.ports
    expect(ports).toHaveLength(before + 1)
    store().removePort('dev-pve1', ports[ports.length - 1].id)
    expect(store().devices.find((d) => d.id === 'dev-pve1')!.ports).toHaveLength(before)
  })

  it('removes the cable attached to a deleted port', () => {
    const cable = store().cables[0]
    store().removePort(cable.from.deviceId, cable.from.portId)
    expect(store().cables.find((c) => c.id === cable.id)).toBeUndefined()
  })

  it('renames a port in place', () => {
    const port = store().devices.find((d) => d.id === 'dev-pve1')!.ports[0]
    store().updatePort('dev-pve1', port.id, { label: 'wan' })
    expect(store().devices.find((d) => d.id === 'dev-pve1')!.ports[0].label).toBe('wan')
  })
})

describe('cables', () => {
  const freePorts = () => {
    const used = new Set(
      store().cables.flatMap((c) => [
        `${c.from.deviceId}:${c.from.portId}`,
        `${c.to.deviceId}:${c.to.portId}`,
      ]),
    )
    const pick = (deviceId: string) => {
      const device = store().devices.find((d) => d.id === deviceId)!
      const port = device.ports.find((p) => !used.has(`${deviceId}:${p.id}`))!
      return { deviceId, portId: port.id }
    }
    return { a: pick('dev-sw24'), b: pick('dev-pve1') }
  }

  it('creates a cable between two free ports', () => {
    const { a, b } = freePorts()
    const id = store().addCable(a, b)
    expect(id).not.toBeNull()
    expect(store().cables.find((c) => c.id === id)!.color).toBeTruthy()
  })

  it('infers the cable type from the port it starts on', () => {
    const sw = store().devices.find((d) => d.id === 'dev-sw24')!
    const nas = store().devices.find((d) => d.id === 'dev-nas')!
    const freeOf = (deviceId: string, type: string) => {
      const patched = new Set(store().cables.flatMap((c) => [c.from.portId, c.to.portId]))
      const device = store().devices.find((d) => d.id === deviceId)!
      return device.ports.find((p) => p.type === type && !patched.has(p.id))!
    }

    const copper = store().addCable(
      { deviceId: sw.id, portId: freeOf(sw.id, 'rj45').id },
      { deviceId: nas.id, portId: freeOf(nas.id, 'rj45').id },
    )
    expect(store().cables.find((c) => c.id === copper)!.type).toBe('ethernet')

    const fiber = store().addCable(
      { deviceId: sw.id, portId: freeOf(sw.id, 'sfp+').id },
      { deviceId: nas.id, portId: freeOf(nas.id, 'rj45').id },
    )
    expect(store().cables.find((c) => c.id === fiber)!.type).toBe('fiber')
  })

  it('refuses a second cable on an already patched port', () => {
    const existing = store().cables[0]
    const { b } = freePorts()
    expect(store().addCable(existing.from, b)).toBeNull()
  })

  it('refuses a port patched to itself', () => {
    const { a } = freePorts()
    expect(store().addCable(a, a)).toBeNull()
  })

  it('refuses an unknown port', () => {
    const { a } = freePorts()
    expect(store().addCable(a, { deviceId: 'dev-pve1', portId: 'nope' })).toBeNull()
  })

  it('builds a cable across two clicks in patch mode', () => {
    const { a, b } = freePorts()
    const before = store().cables.length
    store().pickPort(a.deviceId, a.portId)
    expect(store().cableDraft).toEqual(a)
    store().pickPort(b.deviceId, b.portId)
    expect(store().cableDraft).toBeNull()
    expect(store().cables).toHaveLength(before + 1)
  })

  it('patches by dragging from one port to another', () => {
    const { a, b } = freePorts()
    const before = store().cables.length
    store().startCableDrag(a.deviceId, a.portId)
    expect(store().cableDraft).toEqual(a)
    store().moveCableDrag({ x: 120, y: 80 })
    expect(store().cableDrag).toEqual({ pointer: { x: 120, y: 80 }, moved: true })
    store().endCableDrag(b)
    expect(store().cables).toHaveLength(before + 1)
    expect(store().cableDraft).toBeNull()
    expect(store().cableDrag).toBeNull()
  })

  it('drops the draft when a drag is released on nothing', () => {
    const { a } = freePorts()
    const before = store().cables.length
    store().startCableDrag(a.deviceId, a.portId)
    store().moveCableDrag({ x: 10, y: 10 })
    store().endCableDrag(null)
    expect(store().cables).toHaveLength(before)
    expect(store().cableDraft).toBeNull()
    expect(store().cableDrag).toBeNull()
  })

  it('keeps the port armed when a press never moved, so click-then-click works', () => {
    const { a, b } = freePorts()
    const before = store().cables.length
    store().startCableDrag(a.deviceId, a.portId)
    store().endCableDrag(null)
    expect(store().cableDraft).toEqual(a)
    expect(store().cableDrag).toBeNull()

    store().startCableDrag(b.deviceId, b.portId)
    expect(store().cables).toHaveLength(before + 1)
    expect(store().cableDraft).toBeNull()
  })

  it('disarms when the armed port is pressed again', () => {
    const { a } = freePorts()
    const before = store().cables.length
    store().startCableDrag(a.deviceId, a.portId)
    store().startCableDrag(a.deviceId, a.portId)
    expect(store().cableDraft).toBeNull()
    expect(store().cables).toHaveLength(before)
  })

  it('ignores a release with no drag in flight', () => {
    const { a, b } = freePorts()
    const before = store().cables.length
    store().endCableDrag(b)
    expect(store().cables).toHaveLength(before)
    expect(store().cableDraft).toBeNull()
    // And a move without a drag changes nothing.
    store().moveCableDrag({ x: 1, y: 1 })
    expect(store().cableDrag).toBeNull()
    expect(a).toBeTruthy()
  })

  it('cancels a draft and its drag together', () => {
    const { a } = freePorts()
    store().startCableDrag(a.deviceId, a.portId)
    store().moveCableDrag({ x: 5, y: 5 })
    store().cancelCableDraft()
    expect(store().cableDraft).toBeNull()
    expect(store().cableDrag).toBeNull()
  })

  it('selects a cable and unplugs it with removeSelectedCable', () => {
    const cable = store().cables[0]
    store().selectCable(cable.id)
    expect(store().selectedCableId).toBe(cable.id)
    store().removeSelectedCable()
    expect(store().cables.some((c) => c.id === cable.id)).toBe(false)
    expect(store().selectedCableId).toBeNull()
  })

  it('removeSelectedCable is a no-op with nothing selected', () => {
    const before = store().cables.length
    store().removeSelectedCable()
    expect(store().cables).toHaveLength(before)
  })

  it('clears the cable selection when the cable is removed by id', () => {
    const cable = store().cables[0]
    store().selectCable(cable.id)
    store().removeCable(cable.id)
    expect(store().selectedCableId).toBeNull()
  })

  it('keeps the cable selection when another cable is removed', () => {
    const [first, second] = store().cables
    store().selectCable(first.id)
    store().removeCable(second.id)
    expect(store().selectedCableId).toBe(first.id)
  })

  it('drops the cable selection when a device or rack is selected', () => {
    store().selectCable(store().cables[0].id)
    store().selectDevice(store().devices[0].id)
    expect(store().selectedCableId).toBeNull()

    store().selectCable(store().cables[0].id)
    store().selectRack('rack-main')
    expect(store().selectedCableId).toBeNull()
  })

  it('drops the device and rack selection when a cable is selected', () => {
    // Both drive the right rail, so the two selections cannot coexist.
    store().selectDevice(store().devices[0].id)
    store().selectCable(store().cables[0].id)
    expect(store().selectedDeviceId).toBeNull()
    expect(store().selectedRackId).toBeNull()
  })

  it('keeps the device selection when the cable selection is cleared', () => {
    store().selectDevice(store().devices[0].id)
    store().selectCable(null)
    expect(store().selectedDeviceId).toBe(store().devices[0].id)
  })

  it('edits a cable label, its canvas visibility and its properties', () => {
    const cable = store().cables[0]
    store().updateCable(cable.id, {
      label: 'Uplink to core',
      labelVisible: true,
      properties: [{ key: 'Length', value: '2 m', icon: null, visible: true }],
    })

    const updated = store().cables.find((c) => c.id === cable.id)!
    expect(updated.label).toBe('Uplink to core')
    expect(updated.labelVisible).toBe(true)
    expect(updated.properties).toEqual([{ key: 'Length', value: '2 m', icon: null, visible: true }])
    expect(store().hasUnsavedChanges).toBe(true)
  })

  it('leaves other cables untouched when one is edited', () => {
    const [first, second] = store().cables
    store().updateCable(first.id, { color: '#ff00ff' })
    expect(store().cables.find((c) => c.id === second.id)!.color).toBe(second.color)
  })

  it('drops the cable selection when leaving patch mode', () => {
    store().toggleCableMode()
    store().selectCable(store().cables[0].id)
    store().toggleCableMode()
    expect(store().cableMode).toBe(false)
    expect(store().selectedCableId).toBeNull()
  })

  it('turns cables on when entering patch mode', () => {
    expect(store().cableVisibility).toBe('hover')
    store().toggleCableMode()
    expect(store().cableMode).toBe(true)
    expect(store().cableVisibility).toBe('always')
  })

  it('restores the previous cable visibility when leaving patch mode', () => {
    store().toggleCableMode()
    store().toggleCableMode()
    expect(store().cableMode).toBe(false)
    expect(store().cableVisibility).toBe('hover')
  })

  it('keeps a visibility the user picked while patching', () => {
    store().toggleCableMode()
    store().setCableVisibility('hidden')
    store().toggleCableMode()
    expect(store().cableVisibility).toBe('hidden')
  })

  it('leaves an always-on canvas alone across patch mode', () => {
    store().setCableVisibility('always')
    store().toggleCableMode()
    store().toggleCableMode()
    expect(store().cableVisibility).toBe('always')
  })

  it('imports links from the network canvas', () => {
    // Mount the inventory item the hints reference; the other end is racked already.
    store().mountFromInventory('inv-sw8', 'rack-main', { uStart: 4 })
    const first = store().importCablesFromNetwork(demoNetworkLinks())
    expect(first).toBeGreaterThan(0)
  })

  it('re-running the import adds nothing to a pair already patched', () => {
    // The guard used to be an in-memory flag, so a reload re-armed the import and
    // every link came back on the next free pair of ports. The pair itself is the
    // guard now, and it survives a reload because the cables do.
    store().mountFromInventory('inv-sw8', 'rack-main', { uStart: 4 })
    const created = store().importCablesFromNetwork(demoNetworkLinks())
    const after = store().cables.length

    expect(store().importCablesFromNetwork(demoNetworkLinks())).toBe(0)
    expect(store().cables).toHaveLength(after)
    expect(created).toBeGreaterThan(0)
  })

  it('imports what is newly rackable after a run that matched nothing', () => {
    // Import before racking anything: nothing matches, and the toast tells the
    // user to rack the devices first. That retry has to still work.
    expect(store().importCablesFromNetwork([
      { from: 'node-nowhere-a', to: 'node-nowhere-b', type: 'ethernet' },
    ])).toBe(0)

    store().mountFromInventory('inv-sw8', 'rack-main', { uStart: 4 })
    expect(store().importCablesFromNetwork(demoNetworkLinks())).toBeGreaterThan(0)
  })

  it('lands a fibre link on fibre ports when both plates have a free one', () => {
    const used = new Set(
      store().cables.flatMap((c) => [
        `${c.from.deviceId}:${c.from.portId}`,
        `${c.to.deviceId}:${c.to.portId}`,
      ]),
    )
    // Devices that carry both kinds of free port, so the first free one is copper
    // and picking the fibre one is a real choice rather than the only option.
    const mixed = store().devices.filter((d) => {
      const free = d.ports.filter((p) => !used.has(`${d.id}:${p.id}`))
      return d.nodeId && free.some((p) => p.type === 'rj45') && free.some((p) => p.type !== 'rj45')
    })
    const patched = new Set(
      store().cables.map((c) => [c.from.deviceId, c.to.deviceId].sort().join('|')),
    )
    const pair = mixed.flatMap((x, i) =>
      mixed.slice(i + 1).map((y) => [x, y] as const),
    ).find(([x, y]) => !patched.has([x.id, y.id].sort().join('|')))
    expect(pair).toBeDefined()
    const [a, b] = pair!
    const before = new Set(store().cables.map((c) => c.id))

    store().importCablesFromNetwork([{ from: a.nodeId!, to: b.nodeId!, type: 'fiber' }])

    const cable = store().cables.find((c) => !before.has(c.id))!
    const portOf = (deviceId: string, portId: string) =>
      store().devices.find((d) => d.id === deviceId)!.ports.find((p) => p.id === portId)!
    expect(portOf(cable.from.deviceId, cable.from.portId).type).not.toBe('rj45')
    expect(portOf(cable.to.deviceId, cable.to.portId).type).not.toBe('rj45')
  })

  it('skips hints whose devices are not racked', () => {
    // inv-jbod is never mounted in the demo, so its hint cannot resolve.
    store().importCablesFromNetwork(demoNetworkLinks())
    expect(
      store().cables.some((c) => {
        const from = store().devices.find((d) => d.id === c.from.deviceId)
        return from?.nodeId === 'node-inv-jbod'
      }),
    ).toBe(false)
  })
})

describe('dirty tracking', () => {
  it('starts clean after loading the sample and marks edits', () => {
    // loadDemo seeds unsaved sample data on purpose; a real load starts clean.
    store().markSaved()
    expect(store().hasUnsavedChanges).toBe(false)
    store().addRack()
    expect(store().hasUnsavedChanges).toBe(true)
  })

  it('bumps the edit counter on every mutation', () => {
    const before = store().editSeq
    store().updateRack('rack-main', { name: 'renamed' })
    expect(store().editSeq).toBeGreaterThan(before)
  })

  it('does not dirty the canvas for pan and zoom', () => {
    store().markSaved()
    store().setViewport({ x: 12, y: 34, zoom: 2 })
    expect(store().hasUnsavedChanges).toBe(false)
    expect(store().viewport).toEqual({ x: 12, y: 34, zoom: 2 })
  })

  it('does not dirty the canvas for selection or cable visibility', () => {
    store().markSaved()
    store().selectDevice('dev-sw24')
    store().setCableVisibility('always')
    store().toggleCableMode()
    expect(store().hasUnsavedChanges).toBe(false)
  })

  it('clears everything on reset', () => {
    store().reset()
    expect(store().racks).toEqual([])
    expect(store().devices).toEqual([])
    expect(store().inventory).toEqual([])
    expect(store().hasUnsavedChanges).toBe(false)
  })
})

import { describe, it, expect } from 'vitest'
import {
  FRAME_PAD_PX,
  INTERIOR_TOP_PX,
  U_PX,
  canPlace,
  columnWidth,
  deviceBox,
  findSlot,
  freeUnits,
  isInBounds,
  portPosition,
  rackHeight,
  rackWidth,
  uLabel,
  uToY,
  xToCol,
  yToU,
} from '../layout'
import { DEFAULT_RACK_STYLE } from '../rackDefaults'
import { RACK_COLUMNS, type Port, type Rack, type RackDevice } from '@/types'

function makeRack(patch: Partial<Rack> = {}): Rack {
  return {
    id: 'r1',
    name: 'Rack',
    uHeight: 10,
    widthStandard: '19',
    numbering: 'bottom-up',
    style: { ...DEFAULT_RACK_STYLE },
    position: { x: 0, y: 0 },
    ...patch,
  }
}

function makeDevice(patch: Partial<RackDevice> = {}): RackDevice {
  return {
    id: 'd1',
    rackId: 'r1',
    nodeId: null,
    label: 'dev',
    uStart: 1,
    uHeight: 1,
    colStart: 0,
    colSpan: RACK_COLUMNS,
    faceplateId: 'blank-1u',
    status: 'unknown',
    ports: [],
    ...patch,
  }
}

describe('rack geometry', () => {
  it('places the top U at the top of the frame', () => {
    const rack = makeRack()
    expect(uToY(rack, rack.uHeight, 1)).toBe(INTERIOR_TOP_PX)
    expect(uToY(rack, 1, 1)).toBe(INTERIOR_TOP_PX + (rack.uHeight - 1) * U_PX)
  })

  it('anchors a multi-U device by its lowest U', () => {
    const rack = makeRack()
    // A 2U device starting at U5 occupies U5+U6, so its top edge sits at U6.
    expect(uToY(rack, 5, 2)).toBe(uToY(rack, 6, 1))
  })

  it('round-trips y -> U for every unit', () => {
    const rack = makeRack()
    for (let u = 1; u <= rack.uHeight; u++) {
      expect(yToU(rack, uToY(rack, u, 1) + U_PX / 2)).toBe(u)
    }
  })

  it('clamps out-of-frame pointers into the rack', () => {
    const rack = makeRack()
    expect(yToU(rack, -500)).toBe(rack.uHeight)
    expect(yToU(rack, 5000)).toBe(1)
  })

  it('maps x to a column and clamps at both edges', () => {
    const rack = makeRack()
    expect(xToCol(rack, -100)).toBe(0)
    expect(xToCol(rack, 1e6)).toBe(RACK_COLUMNS - 1)
    const col = columnWidth(rack)
    expect(xToCol(rack, deviceBox(rack, makeDevice()).x + col * 3.5)).toBe(3)
  })

  it('labels U according to the numbering direction', () => {
    const bottomUp = makeRack()
    const topDown = makeRack({ numbering: 'top-down' })
    expect(uLabel(bottomUp, 1)).toBe(1)
    expect(uLabel(bottomUp, 10)).toBe(10)
    expect(uLabel(topDown, 1)).toBe(10)
    expect(uLabel(topDown, 10)).toBe(1)
  })

  it('sizes the node from U height and width standard', () => {
    expect(rackHeight(makeRack({ uHeight: 24 }))).toBe(24 * U_PX + INTERIOR_TOP_PX + FRAME_PAD_PX)
    expect(rackWidth(makeRack({ widthStandard: '10' }))).toBeLessThan(
      rackWidth(makeRack({ widthStandard: '19' })),
    )
  })

  it('drops the number gutter when numbers are hidden', () => {
    const shown = makeRack()
    const hidden = makeRack({ style: { ...DEFAULT_RACK_STYLE, showNumbers: false } })
    expect(rackWidth(hidden)).toBeLessThan(rackWidth(shown))
  })

  it('projects a port into canvas space, rack offset included', () => {
    const rack = makeRack({ position: { x: 100, y: 50 } })
    const device = makeDevice({ uStart: 1, uHeight: 1, colStart: 0, colSpan: RACK_COLUMNS })
    const port: Port = { id: 'p', label: 'p', type: 'rj45', x: 0.5, y: 0.5 }
    const box = deviceBox(rack, device)
    expect(portPosition(rack, device, port)).toEqual({
      x: 100 + box.x + box.width / 2,
      y: 50 + box.y + box.height / 2,
    })
  })
})

describe('occupancy', () => {
  it('rejects placements outside the rack', () => {
    const rack = makeRack()
    expect(isInBounds(rack, { uStart: 0, uHeight: 1, colStart: 0, colSpan: 12 })).toBe(false)
    expect(isInBounds(rack, { uStart: 10, uHeight: 2, colStart: 0, colSpan: 12 })).toBe(false)
    expect(isInBounds(rack, { uStart: 1, uHeight: 1, colStart: 6, colSpan: 12 })).toBe(false)
    expect(isInBounds(rack, { uStart: 9, uHeight: 2, colStart: 0, colSpan: 12 })).toBe(true)
  })

  it('detects a full-width collision', () => {
    const rack = makeRack()
    const devices = [makeDevice({ uStart: 3 })]
    expect(canPlace(rack, devices, { uStart: 3, uHeight: 1, colStart: 0, colSpan: 12 })).toBe(false)
  })

  it('lets two half-width devices share one U', () => {
    const rack = makeRack()
    const devices = [makeDevice({ uStart: 3, colStart: 0, colSpan: 6 })]
    expect(canPlace(rack, devices, { uStart: 3, uHeight: 1, colStart: 6, colSpan: 6 })).toBe(true)
    expect(canPlace(rack, devices, { uStart: 3, uHeight: 1, colStart: 4, colSpan: 6 })).toBe(false)
  })

  it('lets three third-width devices share one U', () => {
    const rack = makeRack()
    const devices = [
      makeDevice({ id: 'a', uStart: 2, colStart: 0, colSpan: 4 }),
      makeDevice({ id: 'b', uStart: 2, colStart: 4, colSpan: 4 }),
    ]
    expect(canPlace(rack, devices, { uStart: 2, uHeight: 1, colStart: 8, colSpan: 4 })).toBe(true)
  })

  it('catches a multi-U overlap from either direction', () => {
    const rack = makeRack()
    const devices = [makeDevice({ uStart: 4, uHeight: 3 })] // U4..U6
    expect(canPlace(rack, devices, { uStart: 6, uHeight: 2, colStart: 0, colSpan: 12 })).toBe(false)
    expect(canPlace(rack, devices, { uStart: 2, uHeight: 3, colStart: 0, colSpan: 12 })).toBe(false)
    expect(canPlace(rack, devices, { uStart: 7, uHeight: 2, colStart: 0, colSpan: 12 })).toBe(true)
  })

  it('ignores the device being moved so a no-op drag stays valid', () => {
    const rack = makeRack()
    const devices = [makeDevice({ id: 'd1', uStart: 5 })]
    expect(canPlace(rack, devices, { uStart: 5, uHeight: 1, colStart: 0, colSpan: 12 })).toBe(false)
    expect(canPlace(rack, devices, { uStart: 5, uHeight: 1, colStart: 0, colSpan: 12 }, 'd1')).toBe(
      true,
    )
  })

  it('ignores devices mounted in another rack', () => {
    const rack = makeRack()
    const devices = [makeDevice({ rackId: 'other', uStart: 5 })]
    expect(canPlace(rack, devices, { uStart: 5, uHeight: 1, colStart: 0, colSpan: 12 })).toBe(true)
  })
})

describe('findSlot', () => {
  it('keeps the requested U when it is free', () => {
    const rack = makeRack()
    const slot = findSlot(rack, [], { uStart: 4, uHeight: 2, colStart: 0, colSpan: 12 })
    expect(slot).toEqual({ uStart: 4, uHeight: 2, colStart: 0, colSpan: 12 })
  })

  it('slides to a free U when the target is taken', () => {
    const rack = makeRack()
    const devices = [makeDevice({ uStart: 4 })]
    const slot = findSlot(rack, devices, { uStart: 4, uHeight: 1, colStart: 0, colSpan: 12 })
    expect(slot).not.toBeNull()
    expect(slot!.uStart).not.toBe(4)
  })

  it('uses free columns on the target U before moving away', () => {
    const rack = makeRack()
    const devices = [makeDevice({ uStart: 4, colStart: 0, colSpan: 6 })]
    const slot = findSlot(rack, devices, { uStart: 4, uHeight: 1, colStart: 7, colSpan: 6 })
    expect(slot).toEqual({ uStart: 4, uHeight: 1, colStart: 6, colSpan: 6 })
  })

  it('clamps a request that would overflow the top', () => {
    const rack = makeRack()
    const slot = findSlot(rack, [], { uStart: 10, uHeight: 3, colStart: 0, colSpan: 12 })
    expect(slot!.uStart).toBe(8)
  })

  it('returns null when the device is taller than the rack', () => {
    const rack = makeRack({ uHeight: 2 })
    expect(findSlot(rack, [], { uStart: 1, uHeight: 4, colStart: 0, colSpan: 12 })).toBeNull()
  })

  it('returns null when the rack is full', () => {
    const rack = makeRack({ uHeight: 2 })
    const devices = [
      makeDevice({ id: 'a', uStart: 1 }),
      makeDevice({ id: 'b', uStart: 2 }),
    ]
    expect(findSlot(rack, devices, { uStart: 1, uHeight: 1, colStart: 0, colSpan: 12 })).toBeNull()
  })
})

describe('freeUnits', () => {
  it('counts a partially filled U as busy', () => {
    const rack = makeRack({ uHeight: 4 })
    const devices = [makeDevice({ uStart: 2, colStart: 0, colSpan: 6 })]
    expect(freeUnits(rack, devices)).toBe(3)
  })

  it('counts multi-U devices once per occupied U', () => {
    const rack = makeRack({ uHeight: 4 })
    const devices = [makeDevice({ uStart: 1, uHeight: 3 })]
    expect(freeUnits(rack, devices)).toBe(1)
  })
})

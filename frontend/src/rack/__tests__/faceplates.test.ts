import { describe, it, expect } from 'vitest'
import { FACEPLATES, bank, faceplateGroups, getFaceplate } from '../faceplates'
import { RACK_COLUMNS, type PortType } from '@/types'

const ALLOWED_PORT_TYPES: PortType[] = ['rj45', 'sfp', 'sfp+']

describe('faceplate catalog', () => {
  it('has unique ids', () => {
    expect(new Set(FACEPLATES.map((f) => f.id)).size).toBe(FACEPLATES.length)
  })

  it('keeps every plate inside the rack grid', () => {
    for (const plate of FACEPLATES) {
      expect(plate.colSpan).toBeGreaterThan(0)
      expect(plate.colSpan).toBeLessThanOrEqual(RACK_COLUMNS)
      expect(plate.uHeight).toBeGreaterThan(0)
    }
  })

  it('only uses data port types', () => {
    for (const plate of FACEPLATES) {
      for (const port of plate.ports) {
        expect(ALLOWED_PORT_TYPES).toContain(port.type)
      }
    }
  })

  it('keeps every port inside the plate', () => {
    for (const plate of FACEPLATES) {
      for (const port of plate.ports) {
        expect(port.x).toBeGreaterThanOrEqual(0)
        expect(port.x).toBeLessThanOrEqual(1)
        expect(port.y).toBeGreaterThanOrEqual(0)
        expect(port.y).toBeLessThanOrEqual(1)
      }
    }
  })

  it('keeps ports clear of the name band', () => {
    for (const plate of FACEPLATES) {
      const labelEnd = plate.labelBox.x + plate.labelBox.w
      for (const port of plate.ports) {
        expect(
          port.x >= labelEnd || port.x <= plate.labelBox.x,
          `${plate.id}: port ${port.label} sits on the label`,
        ).toBe(true)
      }
    }
  })

  it('keeps the name band clear of the status LED and inside the plate', () => {
    for (const plate of FACEPLATES) {
      expect(plate.labelBox.x).toBeGreaterThan(0)
      expect(plate.labelBox.x + plate.labelBox.w).toBeLessThanOrEqual(1)
    }
  })

  it('gives accessories no ports and no status LED', () => {
    for (const plate of FACEPLATES.filter((f) => f.kind === 'accessory')) {
      expect(plate.ports).toHaveLength(0)
      expect(plate.statusLed).toBeFalsy()
    }
  })

  it('shows ports permanently only on patch-facing gear', () => {
    const always = FACEPLATES.filter((f) => f.alwaysShowPorts).map((f) => f.id)
    expect(always).toEqual([
      'switch-8',
      'switch-24',
      'switch-48',
      'patch-24',
      'patch-fiber-12',
    ])
  })

  it('leaves power gear uncabled, with outlets as artwork', () => {
    for (const id of ['pdu-1u', 'ups-2u']) {
      const plate = getFaceplate(id)
      expect(plate.ports).toHaveLength(0)
      expect(plate.elements.some((e) => e.kind === 'outlets')).toBe(true)
    }
  })

  it('keeps the desktop NAS boxes narrow and tall, one bay column each', () => {
    // Bay count → { bays, colSpan }: two doors is a sixth-width tower, four and
    // five a third. All the same height — more disks makes a box wider, not
    // taller — and tall enough that the doors stand up (a U is 24px against a
    // 456px inner width, so the canvas squashes the vertical axis).
    const expected: Record<string, { bays: number; colSpan: number }> = {
      'nas-desktop-2': { bays: 2, colSpan: RACK_COLUMNS / 6 },
      'nas-desktop-4': { bays: 4, colSpan: RACK_COLUMNS / 3 },
      'nas-desktop-5': { bays: 5, colSpan: RACK_COLUMNS / 3 },
    }
    for (const [id, { bays, colSpan }] of Object.entries(expected)) {
      const plate = getFaceplate(id)
      // Shelf-mounted desktop gear, not rack gear: a slice of the width, 5U tall.
      expect(plate.colSpan).toBe(colSpan)
      expect(plate.uHeight).toBe(5)
      const tray = plate.elements.find((e) => e.kind === 'bays')
      expect(tray).toMatchObject({ cols: bays, rows: 1 })
      expect(plate.ports.length).toBeGreaterThan(0)

      // The front is tray doors, portrait, over a thin bottom strip carrying the
      // badge, the LED and the sockets — not a mid-height band like rack gear.
      const band = plate.labelBox.y!
      expect(band).toBeGreaterThan(0.7)
      const trayBottom = tray!.kind === 'bays' ? tray.y + tray.h : 1
      expect(trayBottom).toBeLessThan(band)
      expect(plate.ports.every((p) => p.y === band)).toBe(true)
      // Doors taller than they are wide, at the plate's real aspect (3U on a
      // third of the rack is roughly as tall as it is wide).
      const doorW = (tray!.kind === 'bays' ? tray.w : 0) / bays
      expect(doorW).toBeLessThan(tray!.kind === 'bays' ? tray.h : 0)
    }
  })

  it('draws every desktop NAS door the same size — a disk is a disk', () => {
    // Regression: the stack stretched to fill the plate, so the 2-bay box wore
    // two doors twice as wide as the 5-bay one's. Unit coordinates are
    // fractions of the plate, so compare them scaled by the plate's own width —
    // the 2-bay box is a quarter of the rack, the others a third.
    const doors = ['nas-desktop-2', 'nas-desktop-4', 'nas-desktop-5'].map((id) => {
      const plate = getFaceplate(id)
      const tray = plate.elements.find((e) => e.kind === 'bays')!
      if (tray.kind !== 'bays') throw new Error('no bays')
      return { x: tray.x * plate.colSpan, doorW: (tray.w / tray.cols) * plate.colSpan }
    })
    for (const door of doors) {
      expect(door.doorW).toBeCloseTo(doors[0].doorW, 5)
      // …and the stack starts at the same inset, so the boxes line up on a shelf.
      expect(door.x).toBeCloseTo(doors[0].x, 5)
    }
    // The widest stack still fits the plate.
    const plate5 = getFaceplate('nas-desktop-5').elements.find((e) => e.kind === 'bays')!
    if (plate5.kind !== 'bays') throw new Error('no bays')
    expect(plate5.x + plate5.w).toBeLessThanOrEqual(1)
  })

  it('falls back to the first plate on an unknown id', () => {
    expect(getFaceplate('does-not-exist')).toBe(FACEPLATES[0])
  })

  it('groups the picker without losing a plate', () => {
    const groups = faceplateGroups()
    expect(groups.flatMap((g) => g.items)).toHaveLength(FACEPLATES.length)
    expect(new Set(groups.map((g) => g.group)).size).toBe(groups.length)
  })
})

describe('bank', () => {
  it('centres a single row vertically', () => {
    const ports = bank({ type: 'rj45', count: 4, x: 0, w: 1 })
    expect(ports).toHaveLength(4)
    expect(ports.map((p) => p.x)).toEqual([0.125, 0.375, 0.625, 0.875])
    expect(ports.every((p) => p.y === 0.5)).toBe(true)
  })

  it('spreads two rows evenly around the centre', () => {
    const ports = bank({ type: 'rj45', count: 24, x: 0, w: 1, perRow: 12 })
    const rows = [...new Set(ports.map((p) => p.y))]
    expect(rows).toEqual([1 / 3, 2 / 3])
    expect(ports[0].y).toBeLessThan(ports[12].y)
  })

  it('aligns columns across rows', () => {
    const ports = bank({ type: 'rj45', count: 24, x: 0, w: 1, perRow: 12 })
    for (let i = 0; i < 12; i++) {
      expect(ports[i].x).toBe(ports[i + 12].x)
    }
  })

  it('numbers ports from the given start', () => {
    const ports = bank({ type: 'sfp+', count: 2, x: 0, w: 1, prefix: 'sfp', start: 3 })
    expect(ports.map((p) => p.label)).toEqual(['sfp3', 'sfp4'])
  })
})

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

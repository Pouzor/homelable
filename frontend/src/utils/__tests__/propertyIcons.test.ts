import { describe, it, expect } from 'vitest'
import { Cpu, HardDrive, MemoryStick } from 'lucide-react'
import { PROPERTY_ICONS, PROPERTY_ICON_NAMES, resolvePropertyIcon } from '../propertyIcons'

describe('PROPERTY_ICONS', () => {
  it('contains the hardware migration icons', () => {
    expect(PROPERTY_ICONS['Cpu']).toBe(Cpu)
    expect(PROPERTY_ICONS['HardDrive']).toBe(HardDrive)
    expect(PROPERTY_ICONS['MemoryStick']).toBe(MemoryStick)
  })

  it('has at least 10 icons', () => {
    expect(Object.keys(PROPERTY_ICONS).length).toBeGreaterThanOrEqual(10)
  })

  it('every value is a renderable component (function or object)', () => {
    for (const [, icon] of Object.entries(PROPERTY_ICONS)) {
      // Lucide icons can be functions or forwardRef objects depending on environment
      expect(icon).toBeTruthy()
      expect(['function', 'object']).toContain(typeof icon)
    }
  })
})

describe('PROPERTY_ICON_NAMES', () => {
  it('matches the keys of PROPERTY_ICONS', () => {
    expect(PROPERTY_ICON_NAMES).toEqual(expect.arrayContaining(Object.keys(PROPERTY_ICONS)))
    expect(PROPERTY_ICON_NAMES.length).toBe(Object.keys(PROPERTY_ICONS).length)
  })
})

describe('resolvePropertyIcon', () => {
  it('returns the icon for a known name', () => {
    expect(resolvePropertyIcon('Cpu')).toBe(Cpu)
    expect(resolvePropertyIcon('HardDrive')).toBe(HardDrive)
  })

  it('returns null for null input', () => {
    expect(resolvePropertyIcon(null)).toBeNull()
  })

  it('returns null for undefined input', () => {
    expect(resolvePropertyIcon(undefined)).toBeNull()
  })

  it('returns null for unknown icon name', () => {
    expect(resolvePropertyIcon('NotARealIcon')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(resolvePropertyIcon('')).toBeNull()
  })
})

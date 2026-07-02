import { describe, it, expect } from 'vitest'
import { isZwaveType, buildZwaveProperties } from '../zwaveProperties'

describe('isZwaveType', () => {
  it('returns true for zwave types', () => {
    expect(isZwaveType('zwave_coordinator')).toBe(true)
    expect(isZwaveType('zwave_router')).toBe(true)
    expect(isZwaveType('zwave_enddevice')).toBe(true)
  })

  it('returns false for non-zwave types', () => {
    expect(isZwaveType('zigbee_router')).toBe(false)
    expect(isZwaveType('server')).toBe(false)
    expect(isZwaveType(undefined)).toBe(false)
    expect(isZwaveType(null)).toBe(false)
  })
})

describe('buildZwaveProperties', () => {
  it('builds Z-Wave ID / Vendor / Model rows, all hidden', () => {
    const props = buildZwaveProperties({ ieee_address: 'zwave-0xh-2', vendor: 'Aeotec', model: 'ZW100' })
    expect(props).toEqual([
      { key: 'Z-Wave ID', value: 'zwave-0xh-2', icon: null, visible: false },
      { key: 'Vendor', value: 'Aeotec', icon: null, visible: false },
      { key: 'Model', value: 'ZW100', icon: null, visible: false },
    ])
  })

  it('omits empty fields', () => {
    const props = buildZwaveProperties({ ieee_address: 'zwave-0xh-2', vendor: null, model: undefined })
    expect(props.map((p) => p.key)).toEqual(['Z-Wave ID'])
  })

  it('never adds an LQI row', () => {
    const props = buildZwaveProperties({ ieee_address: 'x', vendor: 'v', model: 'm' })
    expect(props.some((p) => p.key === 'LQI')).toBe(false)
  })
})

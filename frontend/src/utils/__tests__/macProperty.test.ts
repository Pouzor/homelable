import { describe, it, expect } from 'vitest'
import { buildMacProperty } from '../macProperty'

describe('buildMacProperty', () => {
  it('returns a hidden MAC property row for a MAC', () => {
    expect(buildMacProperty('aa:bb:cc:dd:ee:ff')).toEqual([
      { key: 'MAC', value: 'aa:bb:cc:dd:ee:ff', icon: null, visible: false },
    ])
  })

  it('returns an empty array when MAC is null/undefined/empty', () => {
    expect(buildMacProperty(null)).toEqual([])
    expect(buildMacProperty(undefined)).toEqual([])
    expect(buildMacProperty('')).toEqual([])
  })
})

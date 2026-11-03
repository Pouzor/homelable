import { describe, it, expect } from 'vitest'
import { animDuration, clampAnimSpeed, resolveAnimColor } from '../edgeAnimation'

describe('clampAnimSpeed', () => {
  it('defaults unset / invalid values to 1×', () => {
    expect(clampAnimSpeed(undefined)).toBe(1)
    expect(clampAnimSpeed(NaN)).toBe(1)
    expect(clampAnimSpeed(Infinity)).toBe(1)
    expect(clampAnimSpeed(0)).toBe(1)
    expect(clampAnimSpeed(-2)).toBe(1)
  })

  it('clamps to 0.25×–4×', () => {
    expect(clampAnimSpeed(0.1)).toBe(0.25)
    expect(clampAnimSpeed(10)).toBe(4)
    expect(clampAnimSpeed(1.5)).toBe(1.5)
  })
})

describe('animDuration', () => {
  it('keeps the historical durations at 1× / unset', () => {
    expect(animDuration('basic', undefined)).toBe('0.5s')
    expect(animDuration('snake', undefined)).toBe('10s')
    expect(animDuration('flow', 1)).toBe('1.2s')
  })

  it('divides the base duration by the speed', () => {
    expect(animDuration('snake', 2)).toBe('5s')
    expect(animDuration('flow', 0.5)).toBe('2.4s')
    expect(animDuration('basic', 4)).toBe('0.125s')
  })

  it('clamps an out-of-range speed before dividing', () => {
    expect(animDuration('snake', 100)).toBe('2.5s')
  })
})

describe('resolveAnimColor', () => {
  it('accepts a #rrggbb hex', () => {
    expect(resolveAnimColor('#ff00AA')).toBe('#ff00AA')
  })

  it('rejects anything else so the line colour is used', () => {
    expect(resolveAnimColor(undefined)).toBeUndefined()
    expect(resolveAnimColor('')).toBeUndefined()
    expect(resolveAnimColor('red')).toBeUndefined()
    expect(resolveAnimColor('#fff')).toBeUndefined()
    expect(resolveAnimColor('url(#x)')).toBeUndefined()
  })
})

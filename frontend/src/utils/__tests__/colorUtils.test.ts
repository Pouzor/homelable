import { describe, it, expect } from 'vitest'
import { hexToRgba, rgbaToHex8 } from '../colorUtils'

describe('hexToRgba', () => {
  it('splits 8-digit hex into hex6 and alpha', () => {
    const { hex6, alpha } = hexToRgba('#00d4ff0d')
    expect(hex6).toBe('#00d4ff')
    expect(alpha).toBe(5)
  })

  it('handles fully opaque 8-digit hex (ff)', () => {
    const { hex6, alpha } = hexToRgba('#00d4ffff')
    expect(hex6).toBe('#00d4ff')
    expect(alpha).toBe(100)
  })

  it('handles fully transparent 8-digit hex (00)', () => {
    const { hex6, alpha } = hexToRgba('#00d4ff00')
    expect(hex6).toBe('#00d4ff')
    expect(alpha).toBe(0)
  })

  it('defaults alpha to 100 for 6-digit hex', () => {
    const { hex6, alpha } = hexToRgba('#00d4ff')
    expect(hex6).toBe('#00d4ff')
    expect(alpha).toBe(100)
  })

  it('handles 6-digit hex without leading #', () => {
    const { hex6, alpha } = hexToRgba('ff6e00')
    expect(hex6).toBe('#ff6e00')
    expect(alpha).toBe(100)
  })

  it('handles 8-digit hex without leading #', () => {
    const { hex6, alpha } = hexToRgba('ff6e0080')
    expect(hex6).toBe('#ff6e00')
    expect(alpha).toBe(50)
  })

  it('returns fallback for invalid input', () => {
    const { hex6, alpha } = hexToRgba('invalid')
    expect(hex6).toBe('#000000')
    expect(alpha).toBe(100)
  })

  it('is case-insensitive', () => {
    const { hex6 } = hexToRgba('#00D4FF0D')
    expect(hex6).toBe('#00D4FF')
  })
})

describe('rgbaToHex8', () => {
  it('combines hex6 and alpha into 8-digit hex', () => {
    expect(rgbaToHex8('#00d4ff', 5)).toBe('#00d4ff0d')
  })

  it('produces ff for alpha 100', () => {
    expect(rgbaToHex8('#00d4ff', 100)).toBe('#00d4ffff')
  })

  it('produces 00 for alpha 0', () => {
    expect(rgbaToHex8('#00d4ff', 0)).toBe('#00d4ff00')
  })

  it('produces 80 for alpha 50', () => {
    expect(rgbaToHex8('#ff6e00', 50)).toBe('#ff6e0080')
  })

  it('clamps alpha below 0 to 0', () => {
    expect(rgbaToHex8('#ffffff', -10)).toBe('#ffffff00')
  })

  it('clamps alpha above 100 to 100', () => {
    expect(rgbaToHex8('#ffffff', 150)).toBe('#ffffffff')
  })

  it('pads single-digit alpha hex with leading zero', () => {
    const result = rgbaToHex8('#000000', 1)
    const alphaPart = result.slice(7)
    expect(alphaPart.length).toBe(2)
  })
})

describe('round-trip', () => {
  it('hexToRgba → rgbaToHex8 round-trips correctly', () => {
    const original = '#00d4ff0d'
    const { hex6, alpha } = hexToRgba(original)
    expect(rgbaToHex8(hex6, alpha)).toBe(original)
  })

  it('round-trips fully opaque color', () => {
    const original = '#a855f7ff'
    const { hex6, alpha } = hexToRgba(original)
    expect(rgbaToHex8(hex6, alpha)).toBe(original)
  })
})

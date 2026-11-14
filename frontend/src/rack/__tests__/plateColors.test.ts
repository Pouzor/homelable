/**
 * The plate label must stay readable whatever panel colour the user picks: the
 * theme's own text colour wins only while it actually reads on the fill.
 */
import { describe, it, expect } from 'vitest'
import { DARK_INK, LIGHT_INK, contrast, luminance, plateTextColor } from '../plateColors'

describe('luminance and contrast', () => {
  it('spans black to white, and reads #rgb as #rrggbb', () => {
    expect(luminance('#000000')).toBe(0)
    expect(luminance('#fff')).toBeCloseTo(1)
    expect(luminance('#abc')).toBeCloseTo(luminance('#aabbcc')!)
  })

  it('returns 21:1 for black on white, and nothing for a colour it cannot read', () => {
    expect(contrast('#000', '#fff')).toBeCloseTo(21)
    expect(contrast('rgb(1,2,3)', '#fff')).toBeNull()
  })
})

describe('plateTextColor', () => {
  const themeLight = '#e6edf3' // the dark themes' label colour

  it('keeps the theme text on a plate it reads on', () => {
    expect(plateTextColor('#2b323c', themeLight)).toBe(themeLight)
  })

  it('switches to dark ink on a white panel — the reported bug', () => {
    expect(plateTextColor('#f0f0f0', themeLight)).toBe(DARK_INK)
  })

  it('switches to light ink when dark theme text lands on a dark panel', () => {
    expect(plateTextColor('#101010', '#1f2328')).toBe(LIGHT_INK)
  })

  it("keeps a tinted theme's text when it still reads", () => {
    // Matrix green on its near-black plate.
    expect(plateTextColor('#001100', '#00ff41')).toBe('#00ff41')
  })

  it('always honours an explicit pick, readable or not', () => {
    expect(plateTextColor('#ffffff', themeLight, '#fefefe')).toBe('#fefefe')
  })

  it('leaves the theme in charge when it cannot read a colour', () => {
    expect(plateTextColor('rgb(255,255,255)', themeLight)).toBe(themeLight)
  })
})

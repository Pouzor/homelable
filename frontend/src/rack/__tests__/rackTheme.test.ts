import { describe, it, expect } from 'vitest'
import { rackPalette } from '../rackTheme'
import { THEMES, THEME_ORDER } from '@/utils/themes'

describe('rackPalette', () => {
  it('takes the canvas and status colours from the active theme', () => {
    const palette = rackPalette('matrix')
    const theme = THEMES.matrix.colors
    expect(palette.canvas).toBe(theme.canvasBackground)
    expect(palette.dot).toBe(theme.canvasDotColor)
    expect(palette.status.online).toBe(theme.statusColors.online)
    expect(palette.status.offline).toBe(theme.statusColors.offline)
  })

  it('resolves a full palette for every theme, so none renders a blank rack', () => {
    for (const id of THEME_ORDER) {
      const palette = rackPalette(id)
      for (const value of [palette.canvas, palette.plate, palette.text, palette.muted, palette.accent]) {
        expect(value).toBeTruthy()
      }
      expect(palette.defaultRackStyle.showNumbers).toBe(true)
    }
  })

  it('keeps a port recess darker than the plate on a light theme', () => {
    // A jack has to read as a hole, not a highlight.
    const light = rackPalette('light')
    expect(light.portRecess).not.toBe(light.plate)
  })

  it('seeds a new rack with chrome drawn from the theme', () => {
    const palette = rackPalette('neon')
    expect(palette.defaultRackStyle.interior).toBe(THEMES.neon.colors.canvasBackground)
    expect(palette.defaultRackStyle.enclosed).toBe(false)
  })

  it('falls back to the default theme for an unknown id', () => {
    // Guards against a stored theme id that a later release removed.
    const palette = rackPalette('nope' as never)
    expect(palette.canvas).toBe(THEMES.default.colors.canvasBackground)
  })
})

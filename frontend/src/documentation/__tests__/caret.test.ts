/**
 * The slash menu used to be pinned to the bottom-left of the editor pane, so it
 * opened far from the caret and ran off the screen as its list grew. These cover
 * the placement maths that replaced it; the DOM measurement it consumes is not
 * testable here, because jsdom lays nothing out and every offset it reports is 0.
 */
import { describe, it, expect } from 'vitest'
import { placeMenu, type CaretPoint } from '@/documentation/caret'

const caret = (top: number, left = 0, lineHeight = 16): CaretPoint => ({ top, left, lineHeight })

const PANE = { width: 600, height: 800 }
const MENU = { width: 288, height: 260 }

describe('placeMenu', () => {
  it('sits just under the caret when there is room', () => {
    const { top, left, flipped } = placeMenu({ caret: caret(100, 40), pane: PANE, menu: MENU })
    expect(top).toBe(120) // 100 + 16 line + 4 gap
    expect(left).toBe(40)
    expect(flipped).toBe(false)
  })

  it('follows the caret down the pane', () => {
    const high = placeMenu({ caret: caret(50), pane: PANE, menu: MENU }).top
    const low = placeMenu({ caret: caret(300), pane: PANE, menu: MENU }).top
    expect(low - high).toBe(250)
  })

  it('flips above the caret when it would run past the bottom', () => {
    // 700 + 16 + 4 + 260 = 980, well past the 800 pane.
    const { top, flipped } = placeMenu({ caret: caret(700), pane: PANE, menu: MENU })
    expect(flipped).toBe(true)
    expect(top).toBe(436) // 700 - 4 gap - 260 menu
  })

  it('stays below while it still just fits', () => {
    // 520 + 16 + 4 + 260 = exactly 800.
    const { top, flipped } = placeMenu({ caret: caret(520), pane: PANE, menu: MENU })
    expect(flipped).toBe(false)
    expect(top).toBe(540)
  })

  it('never lets the menu hang off the bottom of the pane', () => {
    for (const top of [0, 200, 500, 780, 900]) {
      const placed = placeMenu({ caret: caret(top), pane: PANE, menu: MENU })
      expect(placed.top).toBeGreaterThanOrEqual(0)
      expect(placed.top + MENU.height).toBeLessThanOrEqual(PANE.height)
    }
  })

  it('takes the roomier side and clamps when the menu fits neither', () => {
    const shortPane = { width: 600, height: 200 }
    const low = placeMenu({ caret: caret(160), pane: shortPane, menu: MENU })
    expect(low.flipped).toBe(true)
    expect(low.top).toBe(0) // clamped: 200 - 260 is negative

    const high = placeMenu({ caret: caret(10), pane: shortPane, menu: MENU })
    expect(high.flipped).toBe(false)
    expect(high.top).toBe(0)
  })

  it('pulls the menu left so it does not overflow the right edge', () => {
    const { left } = placeMenu({ caret: caret(100, 500), pane: PANE, menu: MENU })
    expect(left).toBe(312) // 600 - 288
  })

  it('never goes past the left edge', () => {
    const narrow = { width: 200, height: 800 }
    expect(placeMenu({ caret: caret(100, 150), pane: narrow, menu: MENU }).left).toBe(0)
  })

  it('honours a custom gap', () => {
    const { top } = placeMenu({ caret: caret(100), pane: PANE, menu: MENU, gap: 12 })
    expect(top).toBe(128)
  })
})

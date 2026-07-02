import { afterEach, describe, expect, it } from 'vitest'
import {
  getCenteredPosition,
  getViewportCenter,
  setViewportCenterProjector,
} from '../viewportCenter'

afterEach(() => setViewportCenterProjector(null))

describe('viewportCenter', () => {
  it('falls back to a fixed point when no projector is registered', () => {
    expect(getViewportCenter()).toEqual({ x: 300, y: 300 })
    expect(getCenteredPosition()).toEqual({ x: 300, y: 300 })
  })

  it('returns the registered projector value as the centre', () => {
    setViewportCenterProjector(() => ({ x: 1000, y: 500 }))
    expect(getViewportCenter()).toEqual({ x: 1000, y: 500 })
  })

  it('offsets by half the box size so the box is centred', () => {
    setViewportCenterProjector(() => ({ x: 1000, y: 500 }))
    expect(getCenteredPosition(360, 240)).toEqual({ x: 820, y: 380 })
  })

  it('treats a zero size as the raw centre point', () => {
    setViewportCenterProjector(() => ({ x: 42, y: 7 }))
    expect(getCenteredPosition(0, 0)).toEqual({ x: 42, y: 7 })
  })

  it('clears the projector when set to null', () => {
    setViewportCenterProjector(() => ({ x: 1, y: 2 }))
    setViewportCenterProjector(null)
    expect(getViewportCenter()).toEqual({ x: 300, y: 300 })
  })
})

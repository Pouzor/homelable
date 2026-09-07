import { describe, it, expect, beforeEach } from 'vitest'
import { useCanvasStore } from '@/stores/canvasStore'

describe('savedViewport', () => {
  beforeEach(() =>
    useCanvasStore.setState({ savedViewport: null, nodes: [], edges: [], fitViewPending: false }),
  )

  it('setSavedViewport stores the pan/zoom', () => {
    useCanvasStore.getState().setSavedViewport({ x: -120, y: 40, zoom: 0.55 })
    expect(useCanvasStore.getState().savedViewport).toEqual({ x: -120, y: 40, zoom: 0.55 })
  })

  it('setSavedViewport does not dirty the canvas — panning is not an edit', () => {
    useCanvasStore.setState({ hasUnsavedChanges: false })
    useCanvasStore.getState().setSavedViewport({ x: 1, y: 2, zoom: 1.5 })
    expect(useCanvasStore.getState().hasUnsavedChanges).toBe(false)
  })

  it('loadCanvas clears it so a new design fits instead of inheriting a pan/zoom', () => {
    useCanvasStore.setState({ savedViewport: { x: -120, y: 40, zoom: 0.55 } })
    useCanvasStore.getState().loadCanvas([], [])
    expect(useCanvasStore.getState().savedViewport).toBeNull()
    expect(useCanvasStore.getState().fitViewPending).toBe(true)
  })
})

import { describe, it, expect, beforeEach } from 'vitest'
import { useCanvasStore } from '@/stores/canvasStore'

describe('floorMap', () => {
  const fm = {
    imageData: 'data:image/png;base64,abc',
    posX: 10, posY: 20, width: 800, height: 600,
    opacity: 0.8, locked: false, enabled: true,
  }

  beforeEach(() => useCanvasStore.setState({ floorMap: null, hasUnsavedChanges: false }))

  it('setFloorMap sets and marks unsaved', () => {
    useCanvasStore.getState().setFloorMap(fm)
    expect(useCanvasStore.getState().floorMap).toEqual(fm)
    expect(useCanvasStore.getState().hasUnsavedChanges).toBe(true)
  })

  it('setFloorMap(null) clears the plan — prevents cross-design bleed on load', () => {
    useCanvasStore.setState({ floorMap: fm })
    useCanvasStore.getState().setFloorMap(null)
    expect(useCanvasStore.getState().floorMap).toBeNull()
  })

  it('updateFloorMap patches an existing plan (position preserved)', () => {
    useCanvasStore.setState({ floorMap: fm })
    useCanvasStore.getState().updateFloorMap({ posX: 99, opacity: 0.5 })
    expect(useCanvasStore.getState().floorMap).toEqual({ ...fm, posX: 99, opacity: 0.5 })
  })

  it('updateFloorMap is a no-op when no plan exists', () => {
    useCanvasStore.getState().updateFloorMap({ posX: 5 })
    expect(useCanvasStore.getState().floorMap).toBeNull()
  })

  it('requestFloorMapEdit bumps the nonce each call', () => {
    const start = useCanvasStore.getState().floorMapEditNonce
    useCanvasStore.getState().requestFloorMapEdit()
    useCanvasStore.getState().requestFloorMapEdit()
    expect(useCanvasStore.getState().floorMapEditNonce).toBe(start + 2)
  })
})

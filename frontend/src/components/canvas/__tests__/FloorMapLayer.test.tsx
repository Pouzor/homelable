import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { FloorMapLayer } from '../FloorMapLayer'
import { useCanvasStore } from '@/stores/canvasStore'
import type { FloorMapConfig } from '@/types'

// Stub React Flow: render the portal inline, and give the layer a 1x zoom and
// an identity screen→flow projection so it can mount without a provider.
vi.mock('@xyflow/react', () => ({
  ViewportPortal: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useReactFlow: () => ({ screenToFlowPosition: (p: { x: number; y: number }) => p }),
  useStore: (sel: (s: { transform: number[] }) => unknown) => sel({ transform: [0, 0, 1] }),
}))

const BASE: FloorMapConfig = {
  imageData: '/api/v1/media/abc.png',
  posX: 0, posY: 0, width: 800, height: 600,
  opacity: 0.8, locked: false, enabled: true,
}

function setFloorMap(patch: Partial<FloorMapConfig> = {}) {
  useCanvasStore.setState({ floorMap: { ...BASE, ...patch }, floorMapEditNonce: 0 })
}

function wrapper() {
  return screen.getByAltText('Floor plan').parentElement as HTMLElement
}

function handleCount(root: HTMLElement) {
  return Array.from(root.querySelectorAll('div')).filter((d) =>
    (d.getAttribute('style') ?? '').includes('resize'),
  ).length
}

describe('FloorMapLayer', () => {
  beforeEach(() => useCanvasStore.setState({ floorMap: null, floorMapEditNonce: 0 }))

  it('renders nothing when there is no plan or it is disabled', () => {
    const { container, rerender } = render(<FloorMapLayer />)
    expect(container.querySelector('img')).toBeNull()
    setFloorMap({ enabled: false })
    rerender(<FloorMapLayer />)
    expect(container.querySelector('img')).toBeNull()
  })

  it('renders the stored image URL as-is at the root, base64 plans included', () => {
    setFloorMap()
    const { rerender } = render(<FloorMapLayer />)
    expect(screen.getByAltText('Floor plan').getAttribute('src')).toBe('/api/v1/media/abc.png')

    act(() => setFloorMap({ imageData: 'data:image/png;base64,abc' }))
    rerender(<FloorMapLayer />)
    expect(screen.getByAltText('Floor plan').getAttribute('src')).toBe('data:image/png;base64,abc')
  })

  it('hides resize handles until the plan is selected, then shows them (unlocked)', () => {
    setFloorMap()
    render(<FloorMapLayer />)
    expect(handleCount(wrapper())).toBe(0)

    fireEvent.mouseDown(wrapper())
    expect(handleCount(wrapper())).toBe(8)
  })

  it('never shows handles and is non-interactive when locked', () => {
    setFloorMap({ locked: true })
    render(<FloorMapLayer />)
    const w = wrapper()
    fireEvent.mouseDown(w)
    expect(handleCount(w)).toBe(0)
    expect(w.style.pointerEvents).toBe('none')
  })

  it('double-click on an unlocked plan requests the edit modal', () => {
    setFloorMap()
    render(<FloorMapLayer />)
    fireEvent.doubleClick(wrapper())
    expect(useCanvasStore.getState().floorMapEditNonce).toBe(1)
  })

  it('locked plan ignores double-click', () => {
    setFloorMap({ locked: true })
    render(<FloorMapLayer />)
    fireEvent.doubleClick(wrapper())
    expect(useCanvasStore.getState().floorMapEditNonce).toBe(0)
  })

  it('sits at the bottom of the canvas (negative z-index)', () => {
    setFloorMap()
    render(<FloorMapLayer />)
    expect(wrapper().style.zIndex).toBe('-1')
  })
})

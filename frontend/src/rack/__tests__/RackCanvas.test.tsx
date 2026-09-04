/**
 * The empty-state overlay is a child of `<ReactFlow>`, i.e. a sibling of
 * `.react-flow__renderer` (z-index 4). Without an explicit stacking context it
 * paints *under* the pane, which then eats the clicks as a canvas drag — the
 * buttons look enabled but do nothing.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { RackCanvas } from '../components/RackCanvas'
import { useRackStore } from '../store'

const applyViewport = vi.hoisted(() => vi.fn())

vi.mock('@xyflow/react', async () => {
  const { mockReactFlow } = await import('@/test/mocks')
  const React = await import('react')
  return mockReactFlow({
    ReactFlow: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('div', { 'data-testid': 'flow' }, children),
    ReactFlowProvider: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('div', { 'data-testid': 'rack-flow-provider' }, children),
    Background: () => null,
    BackgroundVariant: { Dots: 'dots' },
    Controls: () => null,
    ViewportPortal: () => null,
    useReactFlow: () => ({
      setViewport: applyViewport,
      screenToFlowPosition: (p: { x: number; y: number }) => p,
    }),
  })
})

beforeEach(() => {
  applyViewport.mockClear()
  useRackStore.getState().reset()
})

describe('RackCanvas empty state', () => {
  it('lifts the overlay above the React Flow pane so its buttons are clickable', () => {
    render(<RackCanvas />)
    const overlay = screen.getByText('This rack canvas is empty.').parentElement!
    expect(overlay.className).toContain('z-10')
    // The wrapper stays click-through; only the button row takes pointers.
    expect(overlay.className).toContain('pointer-events-none')
    expect(screen.getByRole('button', { name: /add a rack/i }).parentElement!.className).toContain(
      'pointer-events-auto',
    )
  })

  it('adds a rack from the empty state', () => {
    render(<RackCanvas />)
    fireEvent.click(screen.getByRole('button', { name: /add a rack/i }))
    expect(useRackStore.getState().racks).toHaveLength(1)
  })

  it('loads the sample rack from the empty state', () => {
    render(<RackCanvas />)
    fireEvent.click(screen.getByRole('button', { name: /load a sample rack/i }))
    expect(useRackStore.getState().racks).toHaveLength(1)
    expect(useRackStore.getState().devices.length).toBeGreaterThan(0)
  })

  it('hides the overlay once a rack exists', () => {
    useRackStore.getState().addRack()
    render(<RackCanvas />)
    expect(screen.queryByText('This rack canvas is empty.')).toBeNull()
  })
})

describe('RackCanvas cable keyboard shortcuts', () => {
  const selectFirstCable = () => {
    const store = useRackStore.getState()
    store.loadDemo()
    store.toggleCableMode()
    const cable = useRackStore.getState().cables[0]
    useRackStore.getState().selectCable(cable.id)
    return cable
  }

  it('unplugs the selected cable on Delete', () => {
    const cable = selectFirstCable()
    render(<RackCanvas />)
    fireEvent.keyDown(window, { key: 'Delete' })
    expect(useRackStore.getState().cables.some((c) => c.id === cable.id)).toBe(false)
  })

  it('unplugs the selected cable on Backspace', () => {
    const cable = selectFirstCable()
    render(<RackCanvas />)
    fireEvent.keyDown(window, { key: 'Backspace' })
    expect(useRackStore.getState().cables.some((c) => c.id === cable.id)).toBe(false)
  })

  it('deselects on Escape without removing the cable', () => {
    const cable = selectFirstCable()
    render(<RackCanvas />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(useRackStore.getState().selectedCableId).toBeNull()
    expect(useRackStore.getState().cables.some((c) => c.id === cable.id)).toBe(true)
  })

  it('ignores Delete while typing in an input', () => {
    const cable = selectFirstCable()
    render(
      <>
        <RackCanvas />
        <input data-testid="typing" />
      </>,
    )
    fireEvent.keyDown(screen.getByTestId('typing'), { key: 'Delete' })
    expect(useRackStore.getState().cables.some((c) => c.id === cable.id)).toBe(true)
  })

  it('drops a half-drawn patch on Escape', () => {
    const store = useRackStore.getState()
    store.loadDemo()
    store.toggleCableMode()
    const device = useRackStore.getState().devices[0]
    useRackStore.getState().startCableDrag(device.id, device.ports[0].id)
    render(<RackCanvas />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(useRackStore.getState().cableDraft).toBeNull()
  })

  it('does nothing on Delete with no cable selected', () => {
    useRackStore.getState().loadDemo()
    const before = useRackStore.getState().cables.length
    render(<RackCanvas />)
    fireEvent.keyDown(window, { key: 'Delete' })
    expect(useRackStore.getState().cables).toHaveLength(before)
  })
})

describe('RackCanvas cable dragging', () => {
  const armPort = () => {
    const store = useRackStore.getState()
    store.loadDemo()
    store.toggleCableMode()
    const device = useRackStore.getState().devices[0]
    useRackStore.getState().startCableDrag(device.id, device.ports[0].id)
  }

  it('tracks the pointer while a patch is being dragged', () => {
    armPort()
    render(<RackCanvas />)
    fireEvent.pointerMove(window, { clientX: 64, clientY: 128 })
    // The mocked screenToFlowPosition is the identity.
    expect(useRackStore.getState().cableDrag).toEqual({
      pointer: { x: 64, y: 128 },
      moved: true,
    })
  })

  it('cancels the draft when the drag is released on nothing', () => {
    armPort()
    render(<RackCanvas />)
    fireEvent.pointerMove(window, { clientX: 64, clientY: 128 })
    fireEvent.pointerUp(window)
    expect(useRackStore.getState().cableDraft).toBeNull()
    expect(useRackStore.getState().cableDrag).toBeNull()
  })

  it('keeps the port armed when the press never moved', () => {
    armPort()
    const armed = useRackStore.getState().cableDraft
    render(<RackCanvas />)
    fireEvent.pointerUp(window)
    expect(useRackStore.getState().cableDraft).toEqual(armed)
    expect(useRackStore.getState().cableDrag).toBeNull()
  })
})

/**
 * Switching to another canvas and back remounts `RackCanvas` before `App` calls
 * `loadDesign`, so the restore must not be spent on the pre-load state — that is
 * issue #408, where the racks came back at the wrong pan/zoom until a hard
 * reload.
 */
describe('RackCanvas viewport restore', () => {
  const view = { x: -120, y: -340, zoom: 0.75 }

  it('carries its own React Flow provider, so the logical canvas cannot leak its pan/zoom in', () => {
    render(<RackCanvas />)
    expect(screen.getByTestId('rack-flow-provider')).toContainElement(screen.getByTestId('flow'))
  })

  it('applies the stored viewport once a design is loaded', async () => {
    useRackStore.setState({ designId: 'd1', loading: false, viewport: view })
    render(<RackCanvas />)
    await waitFor(() => expect(applyViewport).toHaveBeenCalledWith(view))
  })

  it('waits for the load to finish rather than restoring the previous state', async () => {
    useRackStore.setState({ designId: 'd1', loading: true, viewport: view })
    render(<RackCanvas />)
    // A frame passes with the fetch still in flight.
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(r))
    })
    expect(applyViewport).not.toHaveBeenCalled()
  })

  it('restores the viewport the load brings back, not the one left over from the last mount', async () => {
    // Mount as a switch-back does: same design id, stale viewport, no load yet.
    useRackStore.setState({ designId: 'd1', loading: false, viewport: view })
    render(<RackCanvas />)
    await waitFor(() => expect(applyViewport).toHaveBeenCalledWith(view))

    const loaded = { x: 40, y: 80, zoom: 1.4 }
    act(() => {
      useRackStore.setState({ loading: true })
    })
    act(() => {
      useRackStore.setState({ loading: false, viewport: loaded })
    })
    await waitFor(() => expect(applyViewport).toHaveBeenLastCalledWith(loaded))
  })

  it('ignores a viewport with no zoom', async () => {
    useRackStore.setState({ designId: 'd1', loading: false, viewport: { x: 0, y: 0, zoom: 0 } })
    render(<RackCanvas />)
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(r))
    })
    expect(applyViewport).not.toHaveBeenCalled()
  })

  it('does not re-apply the viewport when the user pans', async () => {
    useRackStore.setState({ designId: 'd1', loading: false, viewport: view })
    render(<RackCanvas />)
    await waitFor(() => expect(applyViewport).toHaveBeenCalledTimes(1))
    act(() => {
      useRackStore.getState().setViewport({ x: 5, y: 5, zoom: 1 })
    })
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(r))
    })
    expect(applyViewport).toHaveBeenCalledTimes(1)
  })
})

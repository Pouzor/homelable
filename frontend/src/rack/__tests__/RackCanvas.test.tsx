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
import { demoRacks } from '../demoData'

const fitted = { x: -120, y: -340, zoom: 0.75 }
const fitView = vi.hoisted(() => vi.fn(() => Promise.resolve(true)))
const getViewport = vi.hoisted(() => vi.fn())

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
      fitView,
      getViewport,
      screenToFlowPosition: (p: { x: number; y: number }) => p,
    }),
  })
})

beforeEach(() => {
  fitView.mockClear()
  getViewport.mockReset().mockReturnValue(fitted)
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
 * A rack canvas fits its racks into view on load, like the logical canvas
 * (#619). Switching to another canvas and back remounts `RackCanvas` before
 * `App` calls `loadDesign`, so the fit must not be spent on the pre-load state
 * — that is issue #408, where the racks came back at the wrong pan/zoom.
 */
describe('RackCanvas fit on load', () => {
  const nextFrame = () =>
    act(async () => {
      await new Promise((r) => requestAnimationFrame(r))
    })

  it('carries its own React Flow provider, so the logical canvas cannot leak its pan/zoom in', () => {
    render(<RackCanvas />)
    expect(screen.getByTestId('rack-flow-provider')).toContainElement(screen.getByTestId('flow'))
  })

  it('fits the racks once a design is loaded, ignoring the stored pan/zoom', async () => {
    useRackStore.setState({
      designId: 'd1',
      loading: false,
      racks: demoRacks(),
      viewport: { x: 40, y: 80, zoom: 1.4 },
    })
    render(<RackCanvas />)
    await waitFor(() => expect(fitView).toHaveBeenCalledTimes(1))
    expect(fitView).toHaveBeenCalledWith({ padding: 0.12 })
  })

  it('keeps where the fit landed as the viewport a save sends', async () => {
    useRackStore.setState({ designId: 'd1', loading: false, racks: demoRacks() })
    render(<RackCanvas />)
    await waitFor(() => expect(useRackStore.getState().viewport).toEqual(fitted))
  })

  it('waits for the load to finish rather than fitting the previous state', async () => {
    useRackStore.setState({ designId: 'd1', loading: true, racks: demoRacks() })
    render(<RackCanvas />)
    // A frame passes with the fetch still in flight.
    await nextFrame()
    expect(fitView).not.toHaveBeenCalled()
  })

  it('fits again on the load a switch-back triggers', async () => {
    // Mount as a switch-back does: same design id, stale racks, no load yet.
    useRackStore.setState({ designId: 'd1', loading: false, racks: demoRacks() })
    render(<RackCanvas />)
    await waitFor(() => expect(fitView).toHaveBeenCalledTimes(1))

    act(() => {
      useRackStore.setState({ loading: true })
    })
    act(() => {
      useRackStore.setState({ loading: false })
    })
    await waitFor(() => expect(fitView).toHaveBeenCalledTimes(2))
  })

  it('fits each design it switches to', async () => {
    useRackStore.setState({ designId: 'd1', loading: false, racks: demoRacks() })
    render(<RackCanvas />)
    await waitFor(() => expect(fitView).toHaveBeenCalledTimes(1))
    act(() => {
      useRackStore.setState({ designId: 'd2', loading: true })
    })
    act(() => {
      useRackStore.setState({ loading: false })
    })
    await waitFor(() => expect(fitView).toHaveBeenCalledTimes(2))
  })

  it('does not fit an empty design, nor when its first rack is added', async () => {
    useRackStore.setState({ designId: 'd1', loading: false })
    render(<RackCanvas />)
    await nextFrame()
    act(() => {
      useRackStore.getState().addRack()
    })
    await nextFrame()
    expect(fitView).not.toHaveBeenCalled()
  })

  it('does not refit when the user pans or moves a rack', async () => {
    const racks = demoRacks()
    useRackStore.setState({ designId: 'd1', loading: false, racks })
    render(<RackCanvas />)
    await waitFor(() => expect(fitView).toHaveBeenCalledTimes(1))
    act(() => {
      useRackStore.getState().setViewport({ x: 5, y: 5, zoom: 1 })
      useRackStore.getState().moveRack(racks[0].id, { x: 900, y: 900 })
    })
    await nextFrame()
    expect(fitView).toHaveBeenCalledTimes(1)
    expect(useRackStore.getState().viewport).toEqual({ x: 5, y: 5, zoom: 1 })
  })
})

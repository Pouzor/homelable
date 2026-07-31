/**
 * The empty-state overlay is a child of `<ReactFlow>`, i.e. a sibling of
 * `.react-flow__renderer` (z-index 4). Without an explicit stacking context it
 * paints *under* the pane, which then eats the clicks as a canvas drag — the
 * buttons look enabled but do nothing.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { RackCanvas } from '../components/RackCanvas'
import { useRackStore } from '../store'

vi.mock('@xyflow/react', async () => {
  const { mockReactFlow } = await import('@/test/mocks')
  const React = await import('react')
  return mockReactFlow({
    ReactFlow: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('div', { 'data-testid': 'flow' }, children),
    Background: () => null,
    BackgroundVariant: { Dots: 'dots' },
    Controls: () => null,
    ViewportPortal: () => null,
    useReactFlow: () => ({ setViewport: vi.fn() }),
  })
})

beforeEach(() => {
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

/**
 * Cabling overlay: in patch mode a click selects a cable rather than deleting
 * it outright, so a misclick costs nothing and Delete is the destructive step.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { CableLayer } from '../components/CableLayer'
import { useRackStore } from '../store'

vi.mock('@xyflow/react', async () => {
  const { mockReactFlow } = await import('@/test/mocks')
  const React = await import('react')
  return mockReactFlow({
    ViewportPortal: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('div', null, children),
  })
})

/** The fat invisible click targets, one per drawn cable. */
const hitPaths = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<SVGPathElement>('path[stroke="transparent"]'))

beforeEach(() => {
  useRackStore.getState().loadDemo()
})

describe('CableLayer selection', () => {
  it('offers no click target outside patch mode', () => {
    useRackStore.getState().setCableVisibility('always')
    const { container } = render(<CableLayer />)
    expect(hitPaths(container)).toHaveLength(0)
  })

  it('selects a cable on click in patch mode', () => {
    useRackStore.getState().toggleCableMode()
    const { container } = render(<CableLayer />)
    const paths = hitPaths(container)
    expect(paths.length).toBe(useRackStore.getState().cables.length)

    fireEvent.click(paths[0])
    expect(useRackStore.getState().selectedCableId).toBe(useRackStore.getState().cables[0].id)
  })

  it('deselects when the selected cable is clicked again', () => {
    useRackStore.getState().toggleCableMode()
    const { container } = render(<CableLayer />)
    fireEvent.click(hitPaths(container)[0])
    fireEvent.click(hitPaths(container)[0])
    expect(useRackStore.getState().selectedCableId).toBeNull()
  })

  it('leaves the cable in place — clicking never deletes', () => {
    useRackStore.getState().toggleCableMode()
    const before = useRackStore.getState().cables.length
    const { container } = render(<CableLayer />)
    fireEvent.click(hitPaths(container)[0])
    expect(useRackStore.getState().cables).toHaveLength(before)
  })

  it('draws no rubber band until the drag moves', () => {
    const store = useRackStore.getState()
    store.toggleCableMode()
    const port = store.devices[0].ports[0]
    store.startCableDrag(store.devices[0].id, port.id)
    const { queryByTestId } = render(<CableLayer />)
    expect(queryByTestId('cable-draft')).toBeNull()
  })

  it('draws a rubber band from the armed port to the pointer', () => {
    const store = useRackStore.getState()
    store.toggleCableMode()
    const device = store.devices[0]
    store.startCableDrag(device.id, device.ports[0].id)
    store.moveCableDrag({ x: 420, y: 300 })

    const { getByTestId } = render(<CableLayer />)
    const band = getByTestId('cable-draft')
    const end = band.querySelectorAll('circle')[1]
    expect(end.getAttribute('cx')).toBe('420')
    expect(end.getAttribute('cy')).toBe('300')
    expect(band.querySelector('path')!.getAttribute('stroke-dasharray')).toBe('5 4')
  })

  it('draws copper and fibre alike — there is no type filter any more', () => {
    useRackStore.getState().toggleCableMode()
    const { cables } = useRackStore.getState()
    expect(new Set(cables.map((c) => c.type))).toEqual(new Set(['ethernet', 'fiber']))

    const { container } = render(<CableLayer />)
    expect(hitPaths(container)).toHaveLength(cables.length)
  })

  it('draws the selected cable with a highlight halo', () => {
    useRackStore.getState().toggleCableMode()
    const { container, rerender } = render(<CableLayer />)
    const strokeWidths = () =>
      Array.from(container.querySelectorAll<SVGPathElement>('path')).map((p) =>
        p.getAttribute('stroke-width'),
      )
    expect(strokeWidths()).not.toContain('7')

    fireEvent.click(hitPaths(container)[0])
    rerender(<CableLayer />)
    expect(strokeWidths()).toContain('7')
  })
})

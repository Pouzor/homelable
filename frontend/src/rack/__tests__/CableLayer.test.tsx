/**
 * Cabling overlay: in patch mode a click selects a cable rather than deleting
 * it outright, so a misclick costs nothing and Delete is the destructive step.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, fireEvent, act } from '@testing-library/react'
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
  it('selects a cable on click outside patch mode too', () => {
    // A cable is clicked to read and edit it in the rail, not only to unplug it,
    // so the hit target is not gated on patch mode.
    useRackStore.getState().setCableVisibility('always')
    const { container } = render(<CableLayer />)
    const paths = hitPaths(container)
    expect(paths).toHaveLength(useRackStore.getState().cables.length)

    fireEvent.click(paths[0])
    expect(useRackStore.getState().cableMode).toBe(false)
    expect(useRackStore.getState().selectedCableId).toBe(useRackStore.getState().cables[0].id)
  })

  // The overlay paints above the plates and a hit stroke is 14 wide around the
  // run's own end point, so it covered the socket that run is plugged into. A
  // second patch released on a patch panel port landed on the cable and the
  // canvas read it as a drop on nothing.
  it('stops taking the pointer while a patch is in flight', () => {
    const store = useRackStore.getState()
    store.setCableVisibility('always')
    const { container, rerender } = render(<CableLayer />)
    expect(hitPaths(container)[0].style.pointerEvents).toBe('stroke')

    const { from } = useRackStore.getState().cables[0]
    act(() => useRackStore.getState().startCableDrag(from.deviceId, from.portId))
    rerender(<CableLayer />)
    expect(hitPaths(container)[0].style.pointerEvents).toBe('none')

    act(() => useRackStore.getState().cancelCableDraft())
    rerender(<CableLayer />)
    expect(hitPaths(container)[0].style.pointerEvents).toBe('stroke')
  })

  it('keeps the selected cable drawn when cables are hidden', () => {
    // Its panel is open on the right; hiding the run being edited reads as a
    // bug. The header select used to make the selection vanish under the panel.
    const store = useRackStore.getState()
    store.selectCable(store.cables[0].id)
    store.setCableVisibility('hidden')

    const { container } = render(<CableLayer />)
    expect(hitPaths(container)).toHaveLength(1)
  })

  it('draws nothing else when cables are hidden, even on hover', () => {
    const store = useRackStore.getState()
    store.setCableVisibility('hidden')
    store.hoverDevice(store.cables[0].from.deviceId)
    store.selectCable(store.cables[0].id)

    const { container } = render(<CableLayer />)
    expect(hitPaths(container)).toHaveLength(1)
  })

  it('draws nothing when cables are hidden and none is selected', () => {
    useRackStore.getState().setCableVisibility('hidden')
    const { container } = render(<CableLayer />)
    expect(container).toBeEmptyDOMElement()
  })

  it('keeps the selected cable drawn when visibility is hover and nothing is focused', () => {
    const store = useRackStore.getState()
    store.setCableVisibility('hover')
    store.selectCable(store.cables[0].id)

    const { container } = render(<CableLayer />)
    expect(hitPaths(container)).toHaveLength(1)
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

  it('prints nothing beside a cable that has no visible annotation', () => {
    const store = useRackStore.getState()
    store.setCableVisibility('always')
    // A label alone is not enough — it is printed only once the user asks.
    store.updateCable(store.cables[0].id, { label: 'Uplink', labelVisible: false })
    const { queryAllByTestId } = render(<CableLayer />)
    expect(queryAllByTestId('cable-annotation')).toHaveLength(0)
  })

  it('prints the label and the visible properties on the canvas', () => {
    const store = useRackStore.getState()
    store.setCableVisibility('always')
    store.updateCable(store.cables[0].id, {
      label: 'Uplink',
      labelVisible: true,
      properties: [
        { key: 'Length', value: '2 m', icon: null, visible: true },
        { key: 'VLAN', value: '20', icon: null, visible: false },
      ],
    })

    const { getAllByTestId } = render(<CableLayer />)
    const badges = getAllByTestId('cable-annotation')
    expect(badges).toHaveLength(1)
    const lines = Array.from(badges[0].querySelectorAll('text')).map((t) => t.textContent)
    expect(lines).toEqual(['Uplink', 'Length: 2 m'])
  })

  it('prints a value-less property as a bare label', () => {
    const store = useRackStore.getState()
    store.setCableVisibility('always')
    store.updateCable(store.cables[0].id, {
      labelVisible: false,
      properties: [{ key: 'Spare', value: '', icon: null, visible: true }],
    })

    const { getAllByTestId } = render(<CableLayer />)
    const lines = Array.from(getAllByTestId('cable-annotation')[0].querySelectorAll('text')).map((t) => t.textContent)
    expect(lines).toEqual(['Spare'])
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

/** Gives the first cable a printed label, and every cable on screen. */
function labelFirstCable() {
  const store = useRackStore.getState()
  store.setCableVisibility('always')
  store.updateCable(store.cables[0].id, { label: 'Uplink', labelVisible: true })
  return useRackStore.getState().cables[0]
}

/** Centre of a plate, from the text it prints — the plate is centred on it. */
const plateAt = (plate: Element) => {
  const text = plate.querySelector('text')!
  return { x: Number(text.getAttribute('x')) }
}

describe('CableLayer label toggle', () => {
  it('hides every plate when labels are off', () => {
    labelFirstCable()
    useRackStore.getState().setCableLabelsVisible(false)
    const { queryAllByTestId, container } = render(<CableLayer />)
    expect(queryAllByTestId('cable-annotation')).toHaveLength(0)
    // The runs themselves stay drawn — only the plates go.
    expect(hitPaths(container).length).toBeGreaterThan(0)
  })

  it('keeps the plate of the selected cable when labels are off', () => {
    const cable = labelFirstCable()
    useRackStore.getState().setCableLabelsVisible(false)
    useRackStore.getState().selectCable(cable.id)
    const { getAllByTestId } = render(<CableLayer />)
    expect(getAllByTestId('cable-annotation')).toHaveLength(1)
  })

  it('drops the plate of a run dimmed by the hovered device', () => {
    const store = useRackStore.getState()
    store.setCableVisibility('always')
    const [first] = store.cables
    // Every demo run starts on the core switch, so hover the far end: any run
    // that does not touch the hovered device is dimmed.
    const hovered = first.to.deviceId
    const other = store.cables.find(
      (c) => c.from.deviceId !== hovered && c.to.deviceId !== hovered,
    )!
    store.updateCable(first.id, { label: 'Focused', labelVisible: true })
    store.updateCable(other.id, { label: 'Elsewhere', labelVisible: true })
    store.hoverDevice(hovered)

    const { getAllByTestId } = render(<CableLayer />)
    const printed = getAllByTestId('cable-annotation').map((g) => g.querySelector('text')!.textContent)
    expect(printed).toEqual(['Focused'])
  })
})

describe('CableLayer label drag', () => {
  it('draws a plate at its saved offset, tied back to the run', () => {
    labelFirstCable()
    const { getByTestId, queryByTestId, rerender } = render(<CableLayer />)
    const midX = plateAt(getByTestId('cable-annotation')).x
    expect(queryByTestId('cable-annotation-leader')).toBeNull()

    act(() => useRackStore.getState().moveCableLabel(useRackStore.getState().cables[0].id, { x: 50, y: 20 }))
    rerender(<CableLayer />)
    expect(plateAt(getByTestId('cable-annotation')).x).toBeCloseTo(midX + 50)
    const leader = getByTestId('cable-annotation-leader')
    expect(Number(leader.getAttribute('x2')) - Number(leader.getAttribute('x1'))).toBeCloseTo(50)
  })

  it('moves the plate with the pointer and saves the offset once, on release', () => {
    const cable = labelFirstCable()
    const { getByTestId } = render(<CableLayer />)
    const midX = plateAt(getByTestId('cable-annotation')).x
    const seq = useRackStore.getState().editSeq

    // The flow mock maps screen to flow 1:1, so client deltas are offsets.
    fireEvent.pointerDown(getByTestId('cable-annotation'), { button: 0, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(window, { clientX: 130, clientY: 90 })
    // Live while dragging, but nothing written yet.
    expect(plateAt(getByTestId('cable-annotation')).x).toBeCloseTo(midX + 30)
    expect(useRackStore.getState().editSeq).toBe(seq)

    fireEvent.pointerMove(window, { clientX: 160, clientY: 80 })
    act(() => {
      fireEvent.pointerUp(window, { clientX: 160, clientY: 80 })
    })
    const saved = useRackStore.getState().cables.find((c) => c.id === cable.id)!
    expect(saved.labelOffset).toEqual({ x: 60, y: -20 })
    expect(useRackStore.getState().editSeq).toBe(seq + 1)
  })

  it('starts a second drag from where the first one left the plate', () => {
    const cable = labelFirstCable()
    act(() => useRackStore.getState().moveCableLabel(cable.id, { x: 10, y: 10 }))
    const { getByTestId } = render(<CableLayer />)

    fireEvent.pointerDown(getByTestId('cable-annotation'), { button: 0, clientX: 0, clientY: 0 })
    fireEvent.pointerMove(window, { clientX: 5, clientY: 5 })
    act(() => {
      fireEvent.pointerUp(window, { clientX: 5, clientY: 5 })
    })
    expect(useRackStore.getState().cables.find((c) => c.id === cable.id)!.labelOffset).toEqual({ x: 15, y: 15 })
  })

  it('reads a press that barely moves as a click: it selects, and moves nothing', () => {
    const cable = labelFirstCable()
    const { getByTestId } = render(<CableLayer />)
    const plate = getByTestId('cable-annotation')

    fireEvent.pointerDown(plate, { button: 0, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(window, { clientX: 101, clientY: 101 })
    act(() => {
      fireEvent.pointerUp(window, { clientX: 101, clientY: 101 })
    })
    fireEvent.click(plate)

    const state = useRackStore.getState()
    expect(state.cables.find((c) => c.id === cable.id)!.labelOffset).toBeUndefined()
    expect(state.selectedCableId).toBe(cable.id)
  })

  it('does not select the cable on the click that ends a drag', () => {
    labelFirstCable()
    const { getByTestId } = render(<CableLayer />)
    const plate = getByTestId('cable-annotation')

    fireEvent.pointerDown(plate, { button: 0, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(window, { clientX: 140, clientY: 100 })
    act(() => {
      fireEvent.pointerUp(window, { clientX: 140, clientY: 100 })
    })
    fireEvent.click(plate)
    expect(useRackStore.getState().selectedCableId).toBeNull()
  })

  it('opts the plate out of React Flow panning, and out of the pointer mid-patch', () => {
    const cable = labelFirstCable()
    const { getByTestId, rerender } = render(<CableLayer />)
    const plate = () => getByTestId('cable-annotation')
    expect(plate().getAttribute('class')).toContain('nopan')
    expect(plate().style.pointerEvents).toBe('all')

    // A release over the plate must still reach the port underneath it.
    act(() => useRackStore.getState().startCableDrag(cable.from.deviceId, cable.from.portId))
    rerender(<CableLayer />)
    expect(plate().style.pointerEvents).toBe('none')
  })
})


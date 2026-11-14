/**
 * Placing ports on the blown-up plate: handles only exist in drag mode, a drag
 * writes unit coordinates, and the pointer is not the only way in.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { EDITOR_ZOOM_STEPS, PortPositionEditor } from '../components/PortPositionEditor'
import type { Port } from '@/types'

const PLATE = { left: 100, top: 50, width: 400, height: 100 }

const ports: Port[] = [
  { id: 'a', label: 'eth0', type: 'rj45', x: 0.2, y: 0.5 },
  { id: 'b', label: 'eth1', type: 'rj45', x: 0.8, y: 0.5 },
]

function draw(over: Partial<React.ComponentProps<typeof PortPositionEditor>> = {}) {
  const onChange = vi.fn()
  const onSelect = vi.fn()
  render(
    <PortPositionEditor
      faceplateId="switch-8"
      label="sw-01"
      status="online"
      ports={ports}
      uHeight={1}
      colSpan={12}
      interactive
      selectedPortId={null}
      onSelect={onSelect}
      onChange={onChange}
      {...over}
    />,
  )
  return { onChange, onSelect }
}

/** jsdom lays nothing out, so the stage has to be given a size to map against. */
beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    ...PLATE,
    right: PLATE.left + PLATE.width,
    bottom: PLATE.top + PLATE.height,
    x: PLATE.left,
    y: PLATE.top,
    toJSON: () => ({}),
  } as DOMRect)
})

afterEach(() => vi.restoreAllMocks())

/** Drag a handle to a point given in unit coordinates of the plate. */
function dragTo(portId: string, x: number, y: number) {
  const handle = document.querySelector(`[data-port-handle="${portId}"]`)!
  fireEvent.pointerDown(handle)
  fireEvent.pointerMove(screen.getByTestId('faceplate-stage'), {
    clientX: PLATE.left + x * PLATE.width,
    clientY: PLATE.top + y * PLATE.height,
  })
}

describe('PortPositionEditor', () => {
  it('draws no handle at all outside drag mode', () => {
    draw({ interactive: false })
    expect(document.querySelectorAll('[data-port-handle]')).toHaveLength(0)
    // The plate itself is still there: it doubles as the modal's preview.
    expect(screen.getByTestId('faceplate-stage')).toBeInTheDocument()
  })

  it('offers one named handle per port in drag mode', () => {
    draw()
    expect(screen.getByRole('button', { name: 'Move port eth0' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Move port eth1' })).toBeInTheDocument()
  })

  it('writes the drop point as unit coordinates of the plate', () => {
    const { onChange } = draw()
    dragTo('a', 0.5, 0.25)

    const moved = onChange.mock.calls.at(-1)![0] as Port[]
    expect(moved.find((p) => p.id === 'a')).toMatchObject({ x: 0.5, y: 0.25 })
    // The port that was not dragged keeps its place.
    expect(moved.find((p) => p.id === 'b')).toMatchObject({ x: 0.8, y: 0.5 })
  })

  it('snaps onto a peer that is a couple of pixels away', () => {
    const { onChange } = draw()
    // 0.795 of a 400px plate is 2px left of the peer at 0.8 — inside the 6px
    // snap distance, so the two end up on the same column.
    dragTo('a', 0.795, 0.2)

    const moved = onChange.mock.calls.at(-1)![0] as Port[]
    expect(moved.find((p) => p.id === 'a')!.x).toBe(0.8)
  })

  it('selects the port it is about to move', () => {
    const { onSelect } = draw()
    fireEvent.pointerDown(document.querySelector('[data-port-handle="b"]')!)
    expect(onSelect).toHaveBeenCalledWith('b')
  })

  it('nudges the selected port with the arrow keys, wherever focus sits', () => {
    // Regression: the arrows only worked while the handle itself held focus, so
    // selecting a port in the list and reaching for them did nothing.
    const { onChange } = draw({ selectedPortId: 'a' })
    fireEvent.keyDown(document.body, { key: 'ArrowRight' })

    const moved = onChange.mock.calls.at(-1)![0] as Port[]
    expect(moved.find((p) => p.id === 'a')!.x).toBeCloseTo(0.21)
  })

  it('leaves the arrows to a text field being typed in', () => {
    const { onChange } = draw({ selectedPortId: 'a' })
    const field = document.createElement('input')
    document.body.appendChild(field)
    fireEvent.keyDown(field, { key: 'ArrowLeft' })
    expect(onChange).not.toHaveBeenCalled()
    field.remove()
  })

  it('does not move anything outside placement mode', () => {
    const { onChange } = draw({ interactive: false, selectedPortId: 'a' })
    fireEvent.keyDown(document.body, { key: 'ArrowRight' })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('ignores a key that means nothing here', () => {
    const { onChange } = draw({ selectedPortId: 'a' })
    fireEvent.keyDown(document.body, { key: 'Enter' })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('drops the drag when the pointer leaves the plate', () => {
    const { onChange } = draw()
    const stage = screen.getByTestId('faceplate-stage')
    fireEvent.pointerDown(document.querySelector('[data-port-handle="a"]')!)
    fireEvent.pointerLeave(stage)
    fireEvent.pointerMove(stage, { clientX: PLATE.left + 10, clientY: PLATE.top + 10 })
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('PortPositionEditor stage width', () => {
  /** The stage is sized in inline styles, in editor pixels. */
  const stageWidth = () =>
    Number.parseFloat(screen.getByTestId('faceplate-stage').style.width)

  it('draws a full-width plate at the width it was given', () => {
    draw({ fullWidth: 900 })
    expect(stageWidth()).toBeCloseTo(900, 0)
  })

  it('scales a narrower plate to its share of that width', () => {
    // Half-width gear takes half the stage — the blow-up for short plates is
    // capped at the width a full-width plate already gets.
    draw({ fullWidth: 900, colSpan: 6 })
    expect(stageWidth()).toBeGreaterThan(450)
    expect(stageWidth()).toBeLessThanOrEqual(900)
  })

  it('falls back to its own default width when nothing measures', () => {
    // jsdom reports a zero client width and has no ResizeObserver; the plate
    // must keep a usable size rather than collapse to nothing.
    draw()
    expect(stageWidth()).toBeGreaterThan(0)
  })
})

describe('PortPositionEditor zoom', () => {
  const stageWidth = () =>
    Number.parseFloat(screen.getByTestId('faceplate-stage').style.width)
  const zoomIn = () => screen.getByRole('button', { name: 'Zoom in' })
  const zoomOut = () => screen.getByRole('button', { name: 'Zoom out' })

  it('grows the plate past its panel on zoom in, and back on zoom out', () => {
    draw({ fullWidth: 600 })
    expect(screen.getByTestId('faceplate-zoom')).toHaveTextContent('100%')
    expect(zoomOut()).toBeDisabled()

    fireEvent.click(zoomIn())
    fireEvent.click(zoomIn())
    expect(screen.getByTestId('faceplate-zoom')).toHaveTextContent('200%')
    expect(stageWidth()).toBeCloseTo(1200, 0)

    fireEvent.click(zoomOut())
    expect(stageWidth()).toBeCloseTo(900, 0)
  })

  it('stops at the last step', () => {
    draw({ fullWidth: 600 })
    for (let i = 0; i < EDITOR_ZOOM_STEPS.length + 2; i++) fireEvent.click(zoomIn())
    expect(zoomIn()).toBeDisabled()
    expect(stageWidth()).toBeCloseTo(600 * EDITOR_ZOOM_STEPS[EDITOR_ZOOM_STEPS.length - 1], 0)
  })

  it('still lands a dragged port on the plate fraction under the pointer', () => {
    // Positions are fractions of the drawn plate, so magnifying it moves none.
    const { onChange } = draw({ fullWidth: 600 })
    fireEvent.click(zoomIn())
    dragTo('a', 0.4, 0.25)
    const moved = onChange.mock.calls.at(-1)![0].find((p: Port) => p.id === 'a')
    expect(moved.x).toBeCloseTo(0.4, 2)
    expect(moved.y).toBeCloseTo(0.25, 2)
  })

  it('offers no zoom on a plain preview, and draws it at 1×', () => {
    draw({ fullWidth: 600, interactive: false })
    expect(screen.queryByRole('button', { name: 'Zoom in' })).toBeNull()
    expect(stageWidth()).toBeCloseTo(600, 0)
  })
})


import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import type { EdgeProps, Edge } from '@xyflow/react'
import { HomelableEdge } from '../index'
import type { EdgeData } from '@/types'

/**
 * Endpoint markers: per-end shape (arrow / arrow-open / circle / diamond /
 * square) <marker> defs, independently selectable at start/end, filled with the
 * live stroke color, referenced by BaseEdge via markerStart/markerEnd URLs.
 * Legacy boolean values coerce to the filled 'arrow' shape.
 */
function renderEdge(data: Partial<EdgeData> = {}, selected = false) {
  const props = {
    id: 'e1',
    source: 'a',
    target: 'b',
    sourceX: 0,
    sourceY: 0,
    targetX: 100,
    targetY: 100,
    sourcePosition: 'bottom',
    targetPosition: 'top',
    data: { type: 'ethernet', ...data } as EdgeData,
    selected,
  } as unknown as EdgeProps<Edge<EdgeData>>

  return render(
    <ReactFlowProvider>
      <svg>
        <HomelableEdge {...props} />
      </svg>
    </ReactFlowProvider>,
  )
}

describe('HomelableEdge arrow markers', () => {
  it('renders no marker defs by default', () => {
    const { container } = renderEdge()
    expect(container.querySelector('marker')).toBeNull()
  })

  it('renders an end marker referenced by the edge path', () => {
    const { container } = renderEdge({ marker_end: 'arrow' })
    const marker = container.querySelector('#arrow-end-e1')
    expect(marker).toBeTruthy()
    expect(container.querySelector('#arrow-start-e1')).toBeNull()
    const referenced = Array.from(container.querySelectorAll('path')).some(
      (p) => p.getAttribute('marker-end') === 'url(#arrow-end-e1)',
    )
    expect(referenced).toBe(true)
  })

  it('coerces a legacy boolean marker to the filled arrow shape', () => {
    const { container } = renderEdge({ marker_end: true })
    const path = container.querySelector('#arrow-end-e1 path')
    expect(path?.getAttribute('d')).toBe('M 0 0 L 10 5 L 0 10 z')
  })

  it('renders a directional start marker with reversed orientation', () => {
    const { container } = renderEdge({ marker_start: 'arrow' })
    const marker = container.querySelector('#arrow-start-e1')
    expect(marker).toBeTruthy()
    expect(marker?.getAttribute('orient')).toBe('auto-start-reverse')
  })

  it('renders a circle marker as a <circle>, not a triangle', () => {
    const { container } = renderEdge({ marker_end: 'circle' })
    expect(container.querySelector('#arrow-end-e1 circle')).toBeTruthy()
    expect(container.querySelector('#arrow-end-e1 path')).toBeNull()
  })

  it('renders a square marker as a <rect>', () => {
    const { container } = renderEdge({ marker_end: 'square' })
    expect(container.querySelector('#arrow-end-e1 rect')).toBeTruthy()
  })

  it('uses fixed orientation for symmetric shapes', () => {
    const { container } = renderEdge({ marker_end: 'circle' })
    expect(container.querySelector('#arrow-end-e1')?.getAttribute('orient')).toBe('0')
  })

  it('supports different shapes on each end', () => {
    const { container } = renderEdge({ marker_start: 'diamond', marker_end: 'arrow-open' })
    // diamond is a filled path
    const startPath = container.querySelector('#arrow-start-e1 path')
    expect(startPath?.getAttribute('d')).toContain('9.5')
    expect(startPath?.getAttribute('fill')).not.toBe('none')
    // arrow-open is stroked, not filled
    expect(container.querySelector('#arrow-end-e1 path')?.getAttribute('fill')).toBe('none')
  })

  it('renders both markers when both ends enabled', () => {
    const { container } = renderEdge({ marker_start: 'arrow', marker_end: 'arrow' })
    expect(container.querySelector('#arrow-start-e1')).toBeTruthy()
    expect(container.querySelector('#arrow-end-e1')).toBeTruthy()
  })

  it('renders no marker for the "none" shape', () => {
    const { container } = renderEdge({ marker_start: 'none', marker_end: 'none' })
    expect(container.querySelector('marker')).toBeNull()
  })

  it('fills the marker with the resolved custom color', () => {
    const { container } = renderEdge({ marker_end: 'arrow', custom_color: '#ff6e00' })
    const fill = container.querySelector('#arrow-end-e1 path')?.getAttribute('fill')
    expect(fill).toBe('#ff6e00')
  })
})

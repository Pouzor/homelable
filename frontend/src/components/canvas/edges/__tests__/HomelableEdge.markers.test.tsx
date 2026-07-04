import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import type { EdgeProps, Edge } from '@xyflow/react'
import { HomelableEdge } from '../index'
import type { EdgeData } from '@/types'

/**
 * Arrowhead endpoints: filled-triangle <marker> defs, independently toggleable
 * at start/end, filled with the live stroke color, and referenced by BaseEdge
 * via markerStart/markerEnd URLs.
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
    const { container } = renderEdge({ marker_end: true })
    const marker = container.querySelector('#arrow-end-e1')
    expect(marker).toBeTruthy()
    expect(container.querySelector('#arrow-start-e1')).toBeNull()
    const referenced = Array.from(container.querySelectorAll('path')).some(
      (p) => p.getAttribute('marker-end') === 'url(#arrow-end-e1)',
    )
    expect(referenced).toBe(true)
  })

  it('renders a start marker with reversed orientation', () => {
    const { container } = renderEdge({ marker_start: true })
    const marker = container.querySelector('#arrow-start-e1')
    expect(marker).toBeTruthy()
    expect(marker?.getAttribute('orient')).toBe('auto-start-reverse')
  })

  it('renders both markers when both ends enabled', () => {
    const { container } = renderEdge({ marker_start: true, marker_end: true })
    expect(container.querySelector('#arrow-start-e1')).toBeTruthy()
    expect(container.querySelector('#arrow-end-e1')).toBeTruthy()
  })

  it('fills the marker with the resolved custom color', () => {
    const { container } = renderEdge({ marker_end: true, custom_color: '#ff6e00' })
    const fill = container.querySelector('#arrow-end-e1 path')?.getAttribute('fill')
    expect(fill).toBe('#ff6e00')
  })
})

import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import type { EdgeProps, Edge } from '@xyflow/react'
import { HomelableEdge } from '../index'
import type { EdgeData } from '@/types'

/**
 * Per-edge line render: `line_style` overrides the type's dash preset and
 * `width_mult` scales the type base stroke width (1×–4×). Both are optional —
 * unset leaves the edge type's default look untouched.
 */
function renderEdge(data: Partial<EdgeData> = {}) {
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
    selected: false,
  } as unknown as EdgeProps<Edge<EdgeData>>

  return render(
    <ReactFlowProvider>
      <svg>
        <HomelableEdge {...props} />
      </svg>
    </ReactFlowProvider>,
  )
}

/** The BaseEdge path is the one carrying the interaction width. */
function edgePath(container: HTMLElement): SVGPathElement {
  return container.querySelector('path.react-flow__edge-path') as SVGPathElement
    ?? (container.querySelector('path') as SVGPathElement)
}

describe('HomelableEdge line style + width', () => {
  it('scales stroke width by the multiplier (ethernet base 2 × 3 = 6)', () => {
    const { container } = renderEdge({ width_mult: 3 })
    expect(edgePath(container).style.strokeWidth).toBe('6')
  })

  it('keeps the base width when no multiplier is set', () => {
    const { container } = renderEdge()
    expect(edgePath(container).style.strokeWidth).toBe('2')
  })

  it('applies a dash pattern for a dashed line style', () => {
    const { container } = renderEdge({ line_style: 'dashed', width_mult: 2 })
    // width 4 → dashed "12 8"
    expect(edgePath(container).style.strokeDasharray.replace(/,/g, '')).toBe('12 8')
  })

  it('uses a round cap for dotted lines', () => {
    const { container } = renderEdge({ line_style: 'dotted' })
    expect(edgePath(container).style.strokeLinecap).toBe('round')
  })

  it('clears the preset dash for a solid override', () => {
    // wifi defaults to a dashed preset; solid override removes it
    const { container } = renderEdge({ type: 'wifi', line_style: 'solid' })
    expect(edgePath(container).style.strokeDasharray).toBe('')
  })
})

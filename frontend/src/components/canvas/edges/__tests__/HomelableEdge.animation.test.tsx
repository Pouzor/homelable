import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import type { EdgeProps, Edge } from '@xyflow/react'
import { HomelableEdge } from '../index'
import type { EdgeData } from '@/types'

/**
 * Regression: edge flow animations must use CSS, never SVG SMIL <animate>.
 *
 * SMIL <animate> keeps running while the tab is hidden and leaks memory in
 * Chrome over time (RAM climbed only when the canvas tab was backgrounded).
 * CSS animations pause when the tab is hidden and don't leak — so the rendered
 * output must contain a CSS `animation` on the path and zero <animate> nodes.
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

describe('HomelableEdge animation', () => {
  it('renders snake animation as CSS, not SMIL <animate>', () => {
    const { container } = renderEdge({ animated: 'snake' })
    expect(container.querySelector('animate')).toBeNull()
    const animated = Array.from(container.querySelectorAll('path')).find((p) =>
      (p.getAttribute('style') ?? '').includes('homelable-snake'),
    )
    expect(animated).toBeTruthy()
  })

  it('renders flow animation as CSS, not SMIL <animate>', () => {
    const { container } = renderEdge({ animated: 'flow' })
    expect(container.querySelector('animate')).toBeNull()
    const animated = Array.from(container.querySelectorAll('path')).find((p) =>
      (p.getAttribute('style') ?? '').includes('homelable-flow'),
    )
    expect(animated).toBeTruthy()
  })

  it('legacy animated:true maps to snake CSS animation', () => {
    const { container } = renderEdge({ animated: true })
    expect(container.querySelector('animate')).toBeNull()
    const animated = Array.from(container.querySelectorAll('path')).find((p) =>
      (p.getAttribute('style') ?? '').includes('homelable-snake'),
    )
    expect(animated).toBeTruthy()
  })

  it('non-animated edge has no flow animation and no <animate>', () => {
    const { container } = renderEdge({ animated: false })
    expect(container.querySelector('animate')).toBeNull()
    const animated = Array.from(container.querySelectorAll('path')).find((p) => {
      const s = p.getAttribute('style') ?? ''
      return s.includes('homelable-snake') || s.includes('homelable-flow')
    })
    expect(animated).toBeUndefined()
  })
})

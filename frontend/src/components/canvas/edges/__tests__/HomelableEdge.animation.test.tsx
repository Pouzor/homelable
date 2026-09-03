import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
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
function renderEdge(
  data: Partial<EdgeData> = {},
  coords: { sourceY?: number; targetY?: number } = {},
) {
  const props = {
    id: 'e1',
    source: 'a',
    target: 'b',
    sourceX: 0,
    sourceY: coords.sourceY ?? 0,
    targetX: 100,
    targetY: coords.targetY ?? 100,
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

  /**
   * Regression (#395): the basic dash used to flip to `animation-direction:
   * reverse` whenever the source sat below the target on screen, so an edge
   * drawn bottom-to-top animated as if it went target→source. Direction comes
   * from the data (the path is built source→target), never from the geometry.
   */
  it('basic dash animates source→target when the target is below', () => {
    const { container } = renderEdge({ animated: 'basic' }, { sourceY: 0, targetY: 100 })
    const dashed = Array.from(container.querySelectorAll('path')).find((p) =>
      (p.getAttribute('style') ?? '').includes('homelable-basic-dash'),
    )
    expect(dashed).toBeTruthy()
    expect(dashed!.getAttribute('style') ?? '').not.toContain('reverse')
  })

  it('basic dash keeps the same direction when the target is above', () => {
    const { container } = renderEdge({ animated: 'basic' }, { sourceY: 100, targetY: 0 })
    const dashed = Array.from(container.querySelectorAll('path')).find((p) =>
      (p.getAttribute('style') ?? '').includes('homelable-basic-dash'),
    )
    expect(dashed).toBeTruthy()
    expect(dashed!.getAttribute('style') ?? '').not.toContain('reverse')
  })

  /**
   * Regression (#395): the basic dash marched against snake and flow because
   * its keyframes decreased stroke-dashoffset while theirs increase it. All
   * three must move the same way along the path.
   */
  it('basic dash keyframes march the same way as snake and flow', () => {
    const css = readFileSync(resolve(__dirname, '../../../../index.css'), 'utf8')
    const offsets = (name: string) => {
      const block = css.match(new RegExp(`@keyframes ${name} \\{([^}]*\\}[^}]*)\\}`))
      expect(block, `${name} keyframes not found`).toBeTruthy()
      const values = [...block![1].matchAll(/stroke-dashoffset:\s*(-?\d+)/g)].map((m) => Number(m[1]))
      expect(values).toHaveLength(2)
      return values
    }
    const rising = (name: string) => {
      const [from, to] = offsets(name)
      return to > from
    }
    expect(rising('homelable-basic-dash')).toBe(true)
    expect(rising('homelable-snake')).toBe(true)
    expect(rising('homelable-flow')).toBe(true)
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

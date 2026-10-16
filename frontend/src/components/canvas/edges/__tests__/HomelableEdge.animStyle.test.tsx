import { describe, it, expect, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import type { EdgeProps, Edge } from '@xyflow/react'
import { HomelableEdge } from '../index'
import { useThemeStore } from '@/stores/themeStore'
import type { EdgeData, EdgeTypeStyle } from '@/types'

/**
 * Animation speed and highlight colour (#396) live on the edge *type*'s custom
 * style and are read live by the renderer — never copied onto the edge.
 */
function renderEdge(data: Partial<EdgeData>) {
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
    data: { type: 'wifi', ...data } as EdgeData,
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

function animatedPath(container: HTMLElement, keyframes: string) {
  return Array.from(container.querySelectorAll('path')).find((p) =>
    (p.getAttribute('style') ?? '').includes(keyframes),
  )
}

function setWifiStyle(partial: Partial<EdgeTypeStyle>) {
  useThemeStore.setState({
    customStyle: { nodes: {}, edges: { wifi: partial as EdgeTypeStyle } },
  })
}

describe('HomelableEdge type-level animation speed / colour', () => {
  beforeEach(() => {
    useThemeStore.setState({ customStyle: { nodes: {}, edges: {} } })
  })

  it('keeps the default durations without a custom style', () => {
    expect(animatedPath(renderEdge({ animated: 'snake' }).container, 'homelable-snake')!
      .getAttribute('style')).toContain('10s')
  })

  it('scales snake / flow / basic durations by the type speed', () => {
    setWifiStyle({ animSpeed: 2 })
    expect(animatedPath(renderEdge({ animated: 'snake' }).container, 'homelable-snake')!
      .getAttribute('style')).toContain('homelable-snake 5s')
    expect(animatedPath(renderEdge({ animated: 'flow' }).container, 'homelable-flow')!
      .getAttribute('style')).toContain('homelable-flow 0.6s')
    expect(animatedPath(renderEdge({ animated: 'basic' }).container, 'homelable-basic-dash')!
      .getAttribute('style')).toContain('homelable-basic-dash 0.25s')
  })

  it('ignores another type\'s speed', () => {
    useThemeStore.setState({
      customStyle: { nodes: {}, edges: { ethernet: { animSpeed: 4 } as EdgeTypeStyle } },
    })
    expect(animatedPath(renderEdge({ animated: 'flow' }).container, 'homelable-flow')!
      .getAttribute('style')).toContain('homelable-flow 1.2s')
  })

  it('draws the snake highlight in the type animColor, over the edge custom_color', () => {
    setWifiStyle({ animColor: '#ff0000' })
    const { container } = renderEdge({ animated: 'snake', custom_color: '#00ff00' })
    expect(animatedPath(container, 'homelable-snake')!.getAttribute('stroke')).toBe('#ff0000')
  })

  it('falls back to the line colour when animColor is unset or not a hex', () => {
    setWifiStyle({ animColor: 'javascript:alert(1)' })
    const { container } = renderEdge({ animated: 'flow', custom_color: '#00ff00' })
    expect(animatedPath(container, 'homelable-flow')!.getAttribute('stroke')).toBe('#00ff00')
  })

  it('basic mode keeps the line colour', () => {
    setWifiStyle({ animColor: '#ff0000' })
    const { container } = renderEdge({ animated: 'basic', custom_color: '#00ff00' })
    expect(animatedPath(container, 'homelable-basic-dash')!.getAttribute('stroke')).toBe('#00ff00')
  })
})

import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import type { EdgeProps, Edge } from '@xyflow/react'
import type { EdgeData, EdgeTypeStyle } from '@/types'
import { useThemeStore } from '@/stores/themeStore'

/**
 * PR #537 — the canvas hover highlight dims an edge through `edge.style.opacity`.
 * HomelableEdge builds its stroke style from the edge type, so it must read
 * that prop itself and fade the line, its animation overlay and its labels.
 *
 * <EdgeLabelRenderer> is stubbed to a passthrough so the label markup renders
 * outside a full <ReactFlow> host.
 */
vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xyflow/react')>()
  return {
    ...actual,
    EdgeLabelRenderer: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  }
})

const { HomelableEdge } = await import('../index')

function renderEdge(style: React.CSSProperties | undefined, data: Partial<EdgeData> = {}, selected = false) {
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
    style,
  } as unknown as EdgeProps<Edge<EdgeData>>

  return render(
    <ReactFlowProvider>
      <svg>
        <HomelableEdge {...props} />
      </svg>
    </ReactFlowProvider>,
  )
}

describe('HomelableEdge fade', () => {
  it('wraps the line and its animation overlay in a group carrying the opacity', () => {
    const { container } = renderEdge({ opacity: 0.08, transition: 'opacity 0.15s' }, { animated: 'flow' })
    const group = container.querySelector('svg > g') as SVGGElement
    expect(group.style.opacity).toBe('0.08')
    expect(group.style.transition).toBe('opacity 0.15s')
    // BaseEdge path, interaction path and the flow overlay all sit inside it.
    expect(group.querySelectorAll('path').length).toBeGreaterThanOrEqual(3)
  })

  it('fades the label and the LQI badge with the line', () => {
    useThemeStore.setState({
      customStyle: { nodes: {}, edges: { ethernet: { showLqi: true } as EdgeTypeStyle } },
    })
    const { getByText } = renderEdge({ opacity: 0.08 }, { label: 'uplink', lqi: 120 })
    expect((getByText('uplink') as HTMLElement).style.opacity).toBe('0.08')
    expect((getByText('LQI 120') as HTMLElement).style.opacity).toBe('0.08')
  })

  it('sets no opacity when no style is passed, but keeps the transition so the restore fades', () => {
    const { container, getByText } = renderEdge(undefined, { label: 'uplink' })
    const group = container.querySelector('svg > g') as SVGGElement
    expect(group.style.opacity).toBe('')
    expect(group.style.transition).toBe('opacity 0.15s')
    expect((getByText('uplink') as HTMLElement).style.opacity).toBe('')
    expect((getByText('uplink') as HTMLElement).style.transition).toBe('opacity 0.15s')
  })

  it('fades the endpoint dots of a selected edge with the line', () => {
    const { getAllByTitle } = renderEdge({ opacity: 0.08 }, {}, true)
    const dots = getAllByTitle('Drag to reconnect')
    expect(dots).toHaveLength(2)
    for (const dot of dots) {
      expect((dot.parentElement as HTMLElement).style.opacity).toBe('0.08')
    }
  })

  it('renders no handle wrapper for an unselected edge', () => {
    const { queryAllByTitle } = renderEdge({ opacity: 0.08 })
    expect(queryAllByTitle('Drag to reconnect')).toHaveLength(0)
  })
})

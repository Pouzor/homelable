import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import type { EdgeProps, Edge } from '@xyflow/react'
import type { EdgeData, EdgeType, EdgeTypeStyle } from '@/types'
import { useThemeStore } from '@/stores/themeStore'

/**
 * LQI on the link. The value rides on the edge (written by the Zigbee import),
 * but whether it is printed is a per-type view preference read live from the
 * custom style — so toggling it redraws every link of that type at once.
 *
 * <EdgeLabelRenderer> portals into a node that only exists inside a full
 * <ReactFlow> host, so stub it to a passthrough like the label test does.
 */
vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xyflow/react')>()
  return {
    ...actual,
    EdgeLabelRenderer: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  }
})

const { HomelableEdge } = await import('../index')

function showLqiFor(type: EdgeType) {
  useThemeStore.setState({
    customStyle: { nodes: {}, edges: { [type]: { showLqi: true } as EdgeTypeStyle } },
  })
}

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
    data: { type: 'iot', ...data } as EdgeData,
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

describe('HomelableEdge LQI', () => {
  beforeEach(() => {
    useThemeStore.setState({ customStyle: { nodes: {}, edges: {} } })
  })

  it('prints the LQI when the edge type has the toggle on', () => {
    showLqiFor('iot')
    expect(renderEdge({ lqi: 132 }).getByText('LQI 132')).toBeTruthy()
  })

  it('prints it for mesh links too', () => {
    showLqiFor('zigbee_mesh')
    expect(renderEdge({ type: 'zigbee_mesh', lqi: 40 }).getByText('LQI 40')).toBeTruthy()
  })

  it('prints LQI 0 — a dead link is a reading, not a missing one', () => {
    showLqiFor('iot')
    expect(renderEdge({ lqi: 0 }).getByText('LQI 0')).toBeTruthy()
  })

  it('prints nothing while the toggle is off', () => {
    const { queryByText } = renderEdge({ lqi: 132 })
    expect(queryByText('LQI 132')).toBeNull()
  })

  it('prints nothing on an edge that carries no LQI', () => {
    showLqiFor('iot')
    const { container } = renderEdge({ label: 'uplink' })
    expect(container.textContent).not.toContain('LQI')
  })

  it('leaves other edge types alone when the toggle is on for one', () => {
    showLqiFor('iot')
    const { queryByText } = renderEdge({ type: 'ethernet', lqi: 99 })
    expect(queryByText('LQI 99')).toBeNull()
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import type { Node, Edge } from '@xyflow/react'
import type { NodeData, EdgeData } from '@/types'

// ── Capture the props ReactFlow is rendered with ──────────────────────────
const rfPropsSpy = vi.fn()
vi.mock('@xyflow/react', () => ({
  ReactFlowProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  ReactFlow: (props: unknown) => {
    rfPropsSpy(props)
    return <div data-testid="react-flow" />
  },
  Background: () => null,
  Controls: () => null,
  BackgroundVariant: { Dots: 'dots' },
  ConnectionMode: { Loose: 'loose' },
  Position: { Top: 'top', Right: 'right', Bottom: 'bottom', Left: 'left' },
  useReactFlow: () => ({ fitView: vi.fn() }),
}))
vi.mock('@xyflow/react/dist/style.css', () => ({}))
vi.mock('@/api/client', () => ({ liveviewApi: { load: vi.fn() } }))

import { liveviewApi } from '@/api/client'
import LiveView from '../LiveView'

function setSearch(params: string) {
  Object.defineProperty(window, 'location', {
    writable: true,
    value: { ...window.location, search: params, pathname: '/view' },
  })
}

/** Build a /liveview API response with the given nodes/edges. */
const apiResponse = (nodes: unknown[], edges: unknown[] = []) => ({
  data: { nodes, edges, viewport: { x: 0, y: 0, zoom: 1 } },
})

const apiNode = (
  id: string,
  parent_id?: string,
  collapsed?: boolean,
  type = 'server',
) => ({
  id,
  type,
  label: id,
  status: 'online',
  services: [],
  pos_x: 0,
  pos_y: 0,
  parent_id: parent_id ?? null,
  container_mode: type === 'group',
  custom_colors: collapsed !== undefined ? { collapsed } : null,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
})

describe('LiveView — applies collapse filter to the rendered canvas', () => {
  beforeEach(() => {
    rfPropsSpy.mockClear()
    setSearch('?key=valid')
    vi.mocked(liveviewApi.load).mockReset()
  })

  it('hides children of a collapsed group container in view-only mode', async () => {
    vi.mocked(liveviewApi.load).mockResolvedValue(
      apiResponse([apiNode('g1', undefined, true, 'group'), apiNode('c1', 'g1')]),
    )
    render(<LiveView />)
    await waitFor(() => {
      const last = rfPropsSpy.mock.calls[rfPropsSpy.mock.calls.length - 1]?.[0] as
        | { nodes: Node<NodeData>[] }
        | undefined
      expect(last?.nodes.length).toBeGreaterThan(0)
    })
    const last = rfPropsSpy.mock.calls[rfPropsSpy.mock.calls.length - 1][0] as {
      nodes: Node<NodeData>[]
      edges: Edge<EdgeData>[]
    }
    const ids = last.nodes.map((n) => n.id)
    expect(ids).toContain('g1')
    expect(ids).not.toContain('c1')
  })

  it('shows children when the group is expanded', async () => {
    vi.mocked(liveviewApi.load).mockResolvedValue(
      apiResponse([apiNode('g1', undefined, false, 'group'), apiNode('c1', 'g1')]),
    )
    render(<LiveView />)
    await waitFor(() => {
      const last = rfPropsSpy.mock.calls[rfPropsSpy.mock.calls.length - 1]?.[0] as
        | { nodes: Node<NodeData>[] }
        | undefined
      expect(last?.nodes.length).toBeGreaterThan(1)
    })
    const last = rfPropsSpy.mock.calls[rfPropsSpy.mock.calls.length - 1][0] as {
      nodes: Node<NodeData>[]
    }
    const ids = last.nodes.map((n) => n.id)
    expect(ids).toContain('g1')
    expect(ids).toContain('c1')
  })
})

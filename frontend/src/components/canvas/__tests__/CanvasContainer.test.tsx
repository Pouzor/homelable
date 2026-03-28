import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { CanvasContainer } from '../CanvasContainer'
import { useCanvasStore } from '@/stores/canvasStore'
import { useThemeStore } from '@/stores/themeStore'
import type { Node, Edge } from '@xyflow/react'
import type { NodeData, EdgeData } from '@/types'

// Capture props passed to ReactFlow so we can test the callbacks
let rfProps: Record<string, unknown> = {}

vi.mock('@xyflow/react', () => ({
  ReactFlow: (props: Record<string, unknown>) => {
    rfProps = props
    return <div data-testid="react-flow" />
  },
  Background: () => null,
  Controls: () => null,
  BackgroundVariant: { Dots: 'dots' },
  ConnectionMode: { Loose: 'loose' },
}))

vi.mock('@xyflow/react/dist/style.css', () => ({}))

function makeNode(id: string): Node<NodeData> {
  return {
    id,
    type: 'server',
    position: { x: 0, y: 0 },
    data: { label: id, type: 'server', status: 'unknown', services: [] },
  }
}

function makeEdge(id: string): Edge<EdgeData> {
  return { id, source: 'n1', target: 'n2', type: 'ethernet', data: { type: 'ethernet' } }
}

describe('CanvasContainer', () => {
  beforeEach(() => {
    rfProps = {}
    useCanvasStore.setState({ nodes: [], edges: [], selectedNodeId: null })
    useThemeStore.setState({ activeTheme: 'default' })
  })

  // ── Rendering ─────────────────────────────────────────────────────────────

  it('renders without crashing', () => {
    const { getByTestId } = render(<CanvasContainer />)
    expect(getByTestId('react-flow')).toBeDefined()
  })

  it('passes nodes from store to ReactFlow', () => {
    useCanvasStore.setState({ nodes: [makeNode('n1'), makeNode('n2')] })
    render(<CanvasContainer />)
    expect((rfProps.nodes as Node[]).length).toBe(2)
  })

  it('passes edges from store to ReactFlow', () => {
    useCanvasStore.setState({
      nodes: [makeNode('n1'), makeNode('n2')],
      edges: [makeEdge('e1')],
    })
    render(<CanvasContainer />)
    expect((rfProps.edges as Edge[]).length).toBe(1)
  })

  // ── Node click → selection ────────────────────────────────────────────────

  it('calls setSelectedNode with node id on node click', () => {
    const node = makeNode('n1')
    useCanvasStore.setState({ nodes: [node] })
    render(<CanvasContainer />)
    ;(rfProps.onNodeClick as (...args: unknown[]) => unknown)({} as MouseEvent, node)
    expect(useCanvasStore.getState().selectedNodeId).toBe('n1')
  })

  // ── Pane click → deselect ─────────────────────────────────────────────────

  it('calls setSelectedNode(null) on pane click', () => {
    useCanvasStore.setState({ selectedNodeId: 'n1' })
    render(<CanvasContainer />)
    ;(rfProps.onPaneClick as (...args: unknown[]) => unknown)()
    expect(useCanvasStore.getState().selectedNodeId).toBeNull()
  })

  // ── Edge double-click ─────────────────────────────────────────────────────

  it('calls onEdgeDoubleClick prop when an edge is double-clicked', () => {
    const onEdgeDoubleClick = vi.fn()
    const edge = makeEdge('e1')
    render(<CanvasContainer onEdgeDoubleClick={onEdgeDoubleClick} />)
    ;(rfProps.onEdgeDoubleClick as (...args: unknown[]) => unknown)({} as MouseEvent, edge)
    expect(onEdgeDoubleClick).toHaveBeenCalledWith(edge)
  })

  it('does not throw when onEdgeDoubleClick is not provided', () => {
    const edge = makeEdge('e1')
    render(<CanvasContainer />)
    expect(() => {
      ;(rfProps.onEdgeDoubleClick as (...args: unknown[]) => unknown)({} as MouseEvent, edge)
    }).not.toThrow()
  })

  // ── Connection validation ─────────────────────────────────────────────────

  it('isValidConnection returns false for self-connections', () => {
    render(<CanvasContainer />)
    const isValid = rfProps.isValidConnection as (c: { source: string; target: string }) => boolean
    expect(isValid({ source: 'n1', target: 'n1' })).toBe(false)
  })

  it('isValidConnection returns true for different nodes', () => {
    render(<CanvasContainer />)
    const isValid = rfProps.isValidConnection as (c: { source: string; target: string }) => boolean
    expect(isValid({ source: 'n1', target: 'n2' })).toBe(true)
  })

  // ── onConnect prop passthrough ────────────────────────────────────────────

  it('passes onConnect prop to ReactFlow', () => {
    const onConnect = vi.fn()
    render(<CanvasContainer onConnect={onConnect} />)
    ;(rfProps.onConnect as (...args: unknown[]) => unknown)({ source: 'a', target: 'b', sourceHandle: null, targetHandle: null })
    expect(onConnect).toHaveBeenCalledOnce()
  })

  // ── onNodeDragStart prop passthrough ──────────────────────────────────────

  it('passes onNodeDragStart prop to ReactFlow', () => {
    const onNodeDragStart = vi.fn()
    render(<CanvasContainer onNodeDragStart={onNodeDragStart} />)
    expect(rfProps.onNodeDragStart).toBe(onNodeDragStart)
  })

  // ── Canvas settings ───────────────────────────────────────────────────────

  it('enables snapToGrid', () => {
    render(<CanvasContainer />)
    expect(rfProps.snapToGrid).toBe(true)
  })

  it('sets snapGrid to [16, 16]', () => {
    render(<CanvasContainer />)
    expect(rfProps.snapGrid).toEqual([16, 16])
  })
})

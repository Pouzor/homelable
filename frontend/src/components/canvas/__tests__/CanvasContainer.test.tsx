import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { CanvasContainer } from '../CanvasContainer'
import { useCanvasStore } from '@/stores/canvasStore'
import { useThemeStore } from '@/stores/themeStore'
import type { Node, Edge } from '@xyflow/react'
import type { NodeData, EdgeData } from '@/types'

let rfProps: Record<string, unknown> = {}

vi.mock('@xyflow/react', () => ({
  ReactFlow: (props: Record<string, unknown>) => {
    rfProps = props
    return <div data-testid="react-flow" />
  },
  Background: () => null,
  Controls: () => null,
  ControlButton: () => null,
  BackgroundVariant: { Dots: 'dots' },
  ConnectionMode: { Loose: 'loose' },
  SelectionMode: { Partial: 'partial' },
  useReactFlow: () => ({ fitView: vi.fn() }),
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

  it('calls setSelectedNode with node id on node click', () => {
    const node = makeNode('n1')
    useCanvasStore.setState({ nodes: [node] })
    render(<CanvasContainer />)
    ;(rfProps.onNodeClick as (...args: unknown[]) => unknown)({} as MouseEvent, node)
    expect(useCanvasStore.getState().selectedNodeId).toBe('n1')
  })

  it('calls setSelectedNode(null) on pane click', () => {
    useCanvasStore.setState({ selectedNodeId: 'n1' })
    render(<CanvasContainer />)
    ;(rfProps.onPaneClick as (...args: unknown[]) => unknown)()
    expect(useCanvasStore.getState().selectedNodeId).toBeNull()
  })

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

  it('passes onConnect prop to ReactFlow', () => {
    const onConnect = vi.fn()
    render(<CanvasContainer onConnect={onConnect} />)
    ;(rfProps.onConnect as (...args: unknown[]) => unknown)({ source: 'a', target: 'b', sourceHandle: null, targetHandle: null })
    expect(onConnect).toHaveBeenCalledOnce()
  })

  it('passes onNodeDragStart prop to ReactFlow', () => {
    const onNodeDragStart = vi.fn()
    render(<CanvasContainer onNodeDragStart={onNodeDragStart} />)
    expect(rfProps.onNodeDragStart).toBe(onNodeDragStart)
  })

  it('enables snapToGrid', () => {
    render(<CanvasContainer />)
    expect(rfProps.snapToGrid).toBe(true)
  })

  it('sets snapGrid to [8, 8]', () => {
    render(<CanvasContainer />)
    expect(rfProps.snapGrid).toEqual([8, 8])
  })

  it('sets deleteKeyCode to include both Backspace and Delete', () => {
    render(<CanvasContainer />)
    expect(rfProps.deleteKeyCode).toEqual(['Backspace', 'Delete'])
  })

  it('enables selectionOnDrag for lasso selection', () => {
    render(<CanvasContainer />)
    expect(rfProps.selectionOnDrag).toBe(true)
  })

  it('sets panActivationKeyCode to Space', () => {
    render(<CanvasContainer />)
    expect(rfProps.panActivationKeyCode).toBe('Space')
  })

  it('sets panOnDrag to [1, 2]', () => {
    render(<CanvasContainer />)
    expect(rfProps.panOnDrag).toEqual([1, 2])
  })

  it('sets selectionMode to Partial', () => {
    render(<CanvasContainer />)
    expect(rfProps.selectionMode).toBe('partial')
  })

  it('sets multiSelectionKeyCode to Meta and Control', () => {
    render(<CanvasContainer />)
    expect(rfProps.multiSelectionKeyCode).toEqual(['Meta', 'Control'])
  })

  it('clears selectedNode on Ctrl+click instead of selecting', () => {
    const node = makeNode('n1')
    useCanvasStore.setState({ nodes: [node], selectedNodeId: 'n1' })
    render(<CanvasContainer />)
    ;(rfProps.onNodeClick as (...args: unknown[]) => unknown)(
      { ctrlKey: true, metaKey: false } as unknown as MouseEvent,
      node,
    )
    expect(useCanvasStore.getState().selectedNodeId).toBeNull()
  })

  it('clears selectedNode on Cmd+click', () => {
    const node = makeNode('n1')
    useCanvasStore.setState({ nodes: [node], selectedNodeId: 'n1' })
    render(<CanvasContainer />)
    ;(rfProps.onNodeClick as (...args: unknown[]) => unknown)(
      { ctrlKey: false, metaKey: true } as unknown as MouseEvent,
      node,
    )
    expect(useCanvasStore.getState().selectedNodeId).toBeNull()
  })

  it('onBeforeDelete calls snapshotHistory and returns true', async () => {
    const snapshotHistory = vi.fn()
    useCanvasStore.setState({ snapshotHistory } as unknown as Parameters<typeof useCanvasStore.setState>[0])
    render(<CanvasContainer />)
    const result = await (rfProps.onBeforeDelete as () => Promise<boolean>)()
    expect(snapshotHistory).toHaveBeenCalledOnce()
    expect(result).toBe(true)
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, render } from '@testing-library/react'
import { CanvasContainer } from '../CanvasContainer'
import { useCanvasStore } from '@/stores/canvasStore'
import { useThemeStore } from '@/stores/themeStore'
import type { Node, Edge } from '@xyflow/react'
import type { NodeData, EdgeData, NodeType } from '@/types'
import { writeHoverHighlightSettings } from '@/utils/hoverHighlightSettings'

// Capture props passed to ReactFlow so we can test the callbacks
let rfProps: Record<string, unknown> = {}

// Hoisted holder so the mock factory can read the configurable intersection set.
const rf = vi.hoisted(() => ({
  intersecting: [] as unknown[],
  viewport: { x: 0, y: 0, zoom: 1 },
  fitView: vi.fn(() => Promise.resolve(true)),
}))

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
  Position: { Top: 'top', Right: 'right', Bottom: 'bottom', Left: 'left' },
  useReactFlow: () => ({
    fitView: rf.fitView,
    getViewport: () => rf.viewport,
    screenToFlowPosition: vi.fn(),
    getIntersectingNodes: () => rf.intersecting,
    setNodes: vi.fn(),
    getNodes: () => [],
  }),
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
    rf.intersecting = []
    rf.viewport = { x: 0, y: 0, zoom: 1 }
    rf.fitView.mockClear()
    useCanvasStore.setState({
      nodes: [], edges: [], selectedNodeId: null,
      savedViewport: null, fitViewPending: false,
    })
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

  // ── Node double-click ─────────────────────────────────────────────────────

  it('calls onNodeDoubleClick prop when a node is double-clicked', () => {
    const onNodeDoubleClick = vi.fn()
    const node = makeNode('n1')
    render(<CanvasContainer onNodeDoubleClick={onNodeDoubleClick} />)
    ;(rfProps.onNodeDoubleClick as (...args: unknown[]) => unknown)({} as MouseEvent, node)
    expect(onNodeDoubleClick).toHaveBeenCalledWith(node)
  })

  it('does not throw when onNodeDoubleClick is not provided', () => {
    const node = makeNode('n1')
    render(<CanvasContainer />)
    expect(() => {
      ;(rfProps.onNodeDoubleClick as (...args: unknown[]) => unknown)({} as MouseEvent, node)
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

  // ── Drag onto group → onRequestAddToGroup ─────────────────────────────────

  function groupNode(id: string): Node<NodeData> {
    return { id, type: 'group', position: { x: 0, y: 0 }, data: { label: id, type: 'group', status: 'unknown', services: [] } }
  }

  it('fires onRequestAddToGroup when a node is dropped over a group', () => {
    const onRequestAddToGroup = vi.fn()
    const node = makeNode('n1')
    const group = groupNode('g1')
    rf.intersecting = [group]
    render(<CanvasContainer onRequestAddToGroup={onRequestAddToGroup} />)
    ;(rfProps.onNodeDragStop as (...args: unknown[]) => unknown)({} as MouseEvent, node, [node])
    expect(onRequestAddToGroup).toHaveBeenCalledWith({ nodeIds: ['n1'], groupId: 'g1' })
  })

  it('does not fire onRequestAddToGroup when no group is under the node', () => {
    const onRequestAddToGroup = vi.fn()
    const node = makeNode('n1')
    rf.intersecting = [makeNode('n2')]
    render(<CanvasContainer onRequestAddToGroup={onRequestAddToGroup} />)
    ;(rfProps.onNodeDragStop as (...args: unknown[]) => unknown)({} as MouseEvent, node, [node])
    expect(onRequestAddToGroup).not.toHaveBeenCalled()
  })

  it('does not fire onRequestAddToGroup for an already-parented node', () => {
    const onRequestAddToGroup = vi.fn()
    const node = { ...makeNode('n1'), parentId: 'gOther' }
    rf.intersecting = [groupNode('g1')]
    render(<CanvasContainer onRequestAddToGroup={onRequestAddToGroup} />)
    ;(rfProps.onNodeDragStop as (...args: unknown[]) => unknown)({} as MouseEvent, node, [node])
    expect(onRequestAddToGroup).not.toHaveBeenCalled()
  })

  it('does not fire onRequestAddToGroup when the dragged node is itself a group', () => {
    const onRequestAddToGroup = vi.fn()
    const node = groupNode('g2')
    rf.intersecting = [groupNode('g1')]
    render(<CanvasContainer onRequestAddToGroup={onRequestAddToGroup} />)
    ;(rfProps.onNodeDragStop as (...args: unknown[]) => unknown)({} as MouseEvent, node, [node])
    expect(onRequestAddToGroup).not.toHaveBeenCalled()
  })

  // ── Drag onto container node → onRequestAddToContainer ────────────────────

  function containerNode(id: string, type: NodeData['type'] = 'proxmox'): Node<NodeData> {
    return { id, type, position: { x: 0, y: 0 }, data: { label: id, type, status: 'unknown', services: [], container_mode: true } }
  }

  it('fires onRequestAddToContainer when a node is dropped over a container_mode node', () => {
    const onRequestAddToContainer = vi.fn()
    const node = makeNode('n1')
    rf.intersecting = [containerNode('px1')]
    render(<CanvasContainer onRequestAddToContainer={onRequestAddToContainer} />)
    ;(rfProps.onNodeDragStop as (...args: unknown[]) => unknown)({} as MouseEvent, node, [node])
    expect(onRequestAddToContainer).toHaveBeenCalledWith({ nodeIds: ['n1'], containerId: 'px1' })
  })

  it('prefers a group over a container when both intersect', () => {
    const onRequestAddToGroup = vi.fn()
    const onRequestAddToContainer = vi.fn()
    const node = makeNode('n1')
    rf.intersecting = [containerNode('px1'), groupNode('g1')]
    render(<CanvasContainer onRequestAddToGroup={onRequestAddToGroup} onRequestAddToContainer={onRequestAddToContainer} />)
    ;(rfProps.onNodeDragStop as (...args: unknown[]) => unknown)({} as MouseEvent, node, [node])
    expect(onRequestAddToGroup).toHaveBeenCalledWith({ nodeIds: ['n1'], groupId: 'g1' })
    expect(onRequestAddToContainer).not.toHaveBeenCalled()
  })

  it('does not fire onRequestAddToContainer for an already-parented node', () => {
    const onRequestAddToContainer = vi.fn()
    const node = { ...makeNode('n1'), parentId: 'pxOther' }
    rf.intersecting = [containerNode('px1')]
    render(<CanvasContainer onRequestAddToContainer={onRequestAddToContainer} />)
    ;(rfProps.onNodeDragStop as (...args: unknown[]) => unknown)({} as MouseEvent, node, [node])
    expect(onRequestAddToContainer).not.toHaveBeenCalled()
  })

  it('does not fire onRequestAddToContainer when the target node is not in container_mode', () => {
    const onRequestAddToContainer = vi.fn()
    const node = makeNode('n1')
    rf.intersecting = [makeNode('n2')]
    render(<CanvasContainer onRequestAddToContainer={onRequestAddToContainer} />)
    ;(rfProps.onNodeDragStop as (...args: unknown[]) => unknown)({} as MouseEvent, node, [node])
    expect(onRequestAddToContainer).not.toHaveBeenCalled()
  })

  // ── Drag onto a zone → onRequestAddToZone / detach ────────────────────────

  function zoneNode(id: string): Node<NodeData> {
    return { id, type: 'groupRect', position: { x: 0, y: 0 }, data: { label: id, type: 'groupRect', status: 'unknown', services: [] } }
  }

  it('fires onRequestAddToZone when a node is dropped over a zone', () => {
    const onRequestAddToZone = vi.fn()
    const node = makeNode('n1')
    rf.intersecting = [zoneNode('z1')]
    render(<CanvasContainer onRequestAddToZone={onRequestAddToZone} />)
    ;(rfProps.onNodeDragStop as (...args: unknown[]) => unknown)({} as MouseEvent, node, [node])
    expect(onRequestAddToZone).toHaveBeenCalledWith({ nodeIds: ['n1'], zoneId: 'z1' })
  })

  it('prefers a group and a container over a zone when they overlap', () => {
    const onRequestAddToZone = vi.fn()
    const onRequestAddToContainer = vi.fn()
    const node = makeNode('n1')
    rf.intersecting = [zoneNode('z1'), containerNode('px1')]
    render(<CanvasContainer onRequestAddToZone={onRequestAddToZone} onRequestAddToContainer={onRequestAddToContainer} />)
    ;(rfProps.onNodeDragStop as (...args: unknown[]) => unknown)({} as MouseEvent, node, [node])
    expect(onRequestAddToContainer).toHaveBeenCalledWith({ nodeIds: ['n1'], containerId: 'px1' })
    expect(onRequestAddToZone).not.toHaveBeenCalled()
  })

  it('does not fire onRequestAddToZone when the dragged node is a zone itself', () => {
    const onRequestAddToZone = vi.fn()
    const node = zoneNode('z2')
    rf.intersecting = [zoneNode('z1')]
    render(<CanvasContainer onRequestAddToZone={onRequestAddToZone} />)
    ;(rfProps.onNodeDragStop as (...args: unknown[]) => unknown)({} as MouseEvent, node, [node])
    expect(onRequestAddToZone).not.toHaveBeenCalled()
  })

  it('detaches a zone child dropped outside its zone', () => {
    const zone = { ...zoneNode('z1'), position: { x: 100, y: 100 } }
    const child = { ...makeNode('n1'), parentId: 'z1', position: { x: 20, y: 20 } }
    useCanvasStore.setState({ nodes: [zone, child] })
    rf.intersecting = []
    render(<CanvasContainer />)
    ;(rfProps.onNodeDragStop as (...args: unknown[]) => unknown)({} as MouseEvent, child, [child])
    const after = useCanvasStore.getState().nodes.find((n) => n.id === 'n1')!
    expect(after.parentId).toBeUndefined()
    expect(after.position).toEqual({ x: 120, y: 120 })
  })

  it('keeps a zone child parented when it is dropped inside its zone', () => {
    const zone = zoneNode('z1')
    const child = { ...makeNode('n1'), parentId: 'z1' }
    useCanvasStore.setState({ nodes: [zone, child] })
    rf.intersecting = [zone]
    render(<CanvasContainer />)
    ;(rfProps.onNodeDragStop as (...args: unknown[]) => unknown)({} as MouseEvent, child, [child])
    expect(useCanvasStore.getState().nodes.find((n) => n.id === 'n1')?.parentId).toBe('z1')
  })

  // ── Multi-selection drops (#365) ──────────────────────────────────────────

  it('fires onRequestAddToZone with every dragged node, not just the one under the cursor', () => {
    const onRequestAddToZone = vi.fn()
    const dragged = [makeNode('n1'), makeNode('n2'), makeNode('n3')]
    rf.intersecting = [zoneNode('z1')]
    render(<CanvasContainer onRequestAddToZone={onRequestAddToZone} />)
    ;(rfProps.onNodeDragStop as (...args: unknown[]) => unknown)({} as MouseEvent, dragged[0], dragged)
    expect(onRequestAddToZone).toHaveBeenCalledWith({ nodeIds: ['n1', 'n2', 'n3'], zoneId: 'z1' })
  })

  it('leaves zones and groups out of a dragged selection', () => {
    const onRequestAddToZone = vi.fn()
    const dragged = [makeNode('n1'), zoneNode('z1'), groupNode('g1')]
    rf.intersecting = [zoneNode('z2')]
    render(<CanvasContainer onRequestAddToZone={onRequestAddToZone} />)
    ;(rfProps.onNodeDragStop as (...args: unknown[]) => unknown)({} as MouseEvent, dragged[0], dragged)
    expect(onRequestAddToZone).toHaveBeenCalledWith({ nodeIds: ['n1'], zoneId: 'z2' })
  })

  it('never asks to add the destination container to itself', () => {
    const onRequestAddToContainer = vi.fn()
    const target = containerNode('px1')
    const dragged = [makeNode('n1'), target]
    rf.intersecting = [target]
    render(<CanvasContainer onRequestAddToContainer={onRequestAddToContainer} />)
    ;(rfProps.onNodeDragStop as (...args: unknown[]) => unknown)({} as MouseEvent, dragged[0], dragged)
    expect(onRequestAddToContainer).toHaveBeenCalledWith({ nodeIds: ['n1'], containerId: 'px1' })
  })

  it('keeps an already-parented node in the selection with its own parent', () => {
    const onRequestAddToZone = vi.fn()
    const dragged = [makeNode('n1'), { ...makeNode('n2'), parentId: 'pxOther' }]
    rf.intersecting = [zoneNode('z1')]
    render(<CanvasContainer onRequestAddToZone={onRequestAddToZone} />)
    ;(rfProps.onNodeDragStop as (...args: unknown[]) => unknown)({} as MouseEvent, dragged[0], dragged)
    expect(onRequestAddToZone).toHaveBeenCalledWith({ nodeIds: ['n1'], zoneId: 'z1' })
  })

  it('detaches every dragged child when a selection leaves its zone', () => {
    const zone = { ...zoneNode('z1'), position: { x: 100, y: 100 } }
    const c1 = { ...makeNode('n1'), parentId: 'z1', position: { x: 20, y: 20 } }
    const c2 = { ...makeNode('n2'), parentId: 'z1', position: { x: 40, y: 40 } }
    useCanvasStore.setState({ nodes: [zone, c1, c2] })
    rf.intersecting = []
    render(<CanvasContainer />)
    ;(rfProps.onNodeDragStop as (...args: unknown[]) => unknown)({} as MouseEvent, c1, [c1, c2])
    const after = useCanvasStore.getState().nodes
    expect(after.find((n) => n.id === 'n1')!.parentId).toBeUndefined()
    expect(after.find((n) => n.id === 'n2')!.parentId).toBeUndefined()
    expect(after.find((n) => n.id === 'n2')!.position).toEqual({ x: 140, y: 140 })
    // One history entry for the whole selection: a single undo puts both back.
    useCanvasStore.getState().undo()
    const restored = useCanvasStore.getState().nodes
    expect(restored.find((n) => n.id === 'n1')!.parentId).toBe('z1')
    expect(restored.find((n) => n.id === 'n2')!.parentId).toBe('z1')
  })

  // ── Canvas settings ───────────────────────────────────────────────────────

  it('enables snapToGrid', () => {
    render(<CanvasContainer />)
    expect(rfProps.snapToGrid).toBe(true)
  })

  it('sets snapGrid to [8, 8]', () => {
    render(<CanvasContainer />)
    expect(rfProps.snapGrid).toEqual([8, 8])
  })

  // ── Delete key ────────────────────────────────────────────────────────────

  it('sets deleteKeyCode to include both Backspace and Delete', () => {
    render(<CanvasContainer />)
    expect(rfProps.deleteKeyCode).toEqual(['Backspace', 'Delete'])
  })

  // ── Lasso / multi-select ──────────────────────────────────────────────────

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

  it('clears selectedNode (sets null) on Ctrl+click instead of selecting', () => {
    const node = makeNode('n1')
    useCanvasStore.setState({ nodes: [node], selectedNodeId: 'n1' })
    render(<CanvasContainer />)
    ;(rfProps.onNodeClick as (...args: unknown[]) => unknown)(
      { ctrlKey: true, metaKey: false } as unknown as MouseEvent,
      node,
    )
    expect(useCanvasStore.getState().selectedNodeId).toBeNull()
  })

  it('clears selectedNode (sets null) on Cmd+click', () => {
    const node = makeNode('n1')
    useCanvasStore.setState({ nodes: [node], selectedNodeId: 'n1' })
    render(<CanvasContainer />)
    ;(rfProps.onNodeClick as (...args: unknown[]) => unknown)(
      { ctrlKey: false, metaKey: true } as unknown as MouseEvent,
      node,
    )
    expect(useCanvasStore.getState().selectedNodeId).toBeNull()
  })

  // ── onBeforeDelete snapshot ───────────────────────────────────────────────

  it('onBeforeDelete calls snapshotHistory and returns true', async () => {
    const snapshotHistory = vi.fn()
    useCanvasStore.setState({ snapshotHistory } as unknown as Parameters<typeof useCanvasStore.setState>[0])
    render(<CanvasContainer />)
    const result = await (rfProps.onBeforeDelete as () => Promise<boolean>)()
    expect(snapshotHistory).toHaveBeenCalledOnce()
    expect(result).toBe(true)
  })

  // ── Viewport persistence across unmount (#docs round-trip) ────────────────

  it('onMoveEnd stores the viewport the user ended on', () => {
    render(<CanvasContainer />)
    act(() => {
      ;(rfProps.onMoveEnd as (...args: unknown[]) => unknown)({}, { x: -300, y: 120, zoom: 0.5 })
    })
    expect(useCanvasStore.getState().savedViewport).toEqual({ x: -300, y: 120, zoom: 0.5 })
  })

  it('mounts at the stored viewport — leaving for Documentation must not reset to 1:1', () => {
    useCanvasStore.setState({ savedViewport: { x: -300, y: 120, zoom: 0.5 } })
    render(<CanvasContainer />)
    expect(rfProps.defaultViewport).toEqual({ x: -300, y: 120, zoom: 0.5 })
  })

  it('keeps the stored viewport across an unmount / remount round-trip', () => {
    const first = render(<CanvasContainer />)
    act(() => {
      ;(rfProps.onMoveEnd as (...args: unknown[]) => unknown)({}, { x: -80, y: 15, zoom: 0.75 })
    })
    first.unmount()
    render(<CanvasContainer />)
    expect(rfProps.defaultViewport).toEqual({ x: -80, y: 15, zoom: 0.75 })
  })

  it('leaves defaultViewport undefined on a first load, so React Flow fits', () => {
    render(<CanvasContainer />)
    expect(rfProps.defaultViewport).toBeUndefined()
  })

  it('does not feed a later pan back into defaultViewport (read once, on mount)', () => {
    render(<CanvasContainer />)
    act(() => {
      ;(rfProps.onMoveEnd as (...args: unknown[]) => unknown)({}, { x: -80, y: 15, zoom: 0.75 })
    })
    expect(rfProps.defaultViewport).toBeUndefined()
  })

  it('stores where fitView landed, so the fitted view survives the round-trip', async () => {
    vi.useFakeTimers()
    try {
      rf.viewport = { x: -42, y: 7, zoom: 0.6 }
      useCanvasStore.setState({ nodes: [makeNode('n1')], fitViewPending: true })
      render(<CanvasContainer />)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100)
      })
      expect(rf.fitView).toHaveBeenCalledOnce()
      expect(useCanvasStore.getState().savedViewport).toEqual({ x: -42, y: 7, zoom: 0.6 })
      expect(useCanvasStore.getState().fitViewPending).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  // ── Hover highlight ───────────────────────────────────────────────────────

  describe('hover highlight', () => {
    beforeEach(() => {
      localStorage.removeItem('homelable.hoverHighlight')
    })

    // n1 — n2 — n3, plus n4 on its own.
    function setupChain() {
      useCanvasStore.setState({
        nodes: [makeNode('n1'), makeNode('n2'), makeNode('n3'), makeNode('n4')],
        edges: [
          { id: 'e12', source: 'n1', target: 'n2', type: 'ethernet', data: { type: 'ethernet' } },
          { id: 'e23', source: 'n2', target: 'n3', type: 'ethernet', data: { type: 'ethernet' } },
        ],
      })
      render(<CanvasContainer />)
    }

    const hover = (node: Node<NodeData>) => act(() => {
      ;(rfProps.onNodeMouseEnter as (...args: unknown[]) => unknown)({}, node)
    })
    const opacities = (items: unknown) =>
      Object.fromEntries((items as (Node | Edge)[]).map((i) => [i.id, i.style?.opacity]))

    it('fades node opacity both ways through a stylesheet transition, not an inline one', () => {
      // The inline opacity is dropped on leave; an inline transition would go
      // with it and make the restore instant.
      const css = readFileSync(resolve(__dirname, '../../../index.css'), 'utf8')
      expect(css).toMatch(/\.react-flow__node\s*\{[^}]*transition:\s*opacity 0\.15s/)
      setupChain()
      hover(makeNode('n1'))
      expect((rfProps.nodes as Node[]).every((n) => n.style?.transition === undefined)).toBe(true)
    })

    it('applies no opacity until a node is hovered', () => {
      setupChain()
      expect(opacities(rfProps.nodes)).toEqual({ n1: undefined, n2: undefined, n3: undefined, n4: undefined })
      expect(opacities(rfProps.edges)).toEqual({ e12: undefined, e23: undefined })
    })

    it('keeps the hovered node, its neighbours and incident edges opaque and dims the rest', () => {
      setupChain()
      hover(makeNode('n1'))
      expect(opacities(rfProps.nodes)).toEqual({ n1: 1, n2: 1, n3: 0.12, n4: 0.12 })
      expect(opacities(rfProps.edges)).toEqual({ e12: 1, e23: 0.08 })
    })

    it('follows edges in both directions', () => {
      setupChain()
      hover(makeNode('n2'))
      expect(opacities(rfProps.nodes)).toEqual({ n1: 1, n2: 1, n3: 1, n4: 0.12 })
      expect(opacities(rfProps.edges)).toEqual({ e12: 1, e23: 1 })
    })

    it('restores everything when the pointer leaves the node', () => {
      setupChain()
      hover(makeNode('n1'))
      act(() => {
        ;(rfProps.onNodeMouseLeave as (...args: unknown[]) => unknown)({}, makeNode('n1'))
      })
      expect(opacities(rfProps.nodes)).toEqual({ n1: undefined, n2: undefined, n3: undefined, n4: undefined })
      expect(opacities(rfProps.edges)).toEqual({ e12: undefined, e23: undefined })
    })

    it('never writes the hover opacity into the store', () => {
      setupChain()
      hover(makeNode('n1'))
      expect(useCanvasStore.getState().nodes.every((n) => n.style?.opacity === undefined)).toBe(true)
      expect(useCanvasStore.getState().edges.every((e) => e.style?.opacity === undefined)).toBe(true)
    })

    it.each(['groupRect', 'group', 'text'] as const)('does not dim the canvas when a %s is hovered', (type) => {
      setupChain()
      hover({ ...makeNode('furniture'), type, data: { ...makeNode('furniture').data, type } })
      expect(opacities(rfProps.nodes)).toEqual({ n1: undefined, n2: undefined, n3: undefined, n4: undefined })
    })

    function child(id: string, parentId: string, type: NodeType = 'docker_container'): Node<NodeData> {
      return { ...makeNode(id), type, parentId, data: { ...makeNode(id).data, type } }
    }

    it('keeps the children of a lit container lit, all the way down', () => {
      useCanvasStore.setState({
        nodes: [
          makeNode('sw'),
          { ...makeNode('pve'), type: 'proxmox', data: { ...makeNode('pve').data, type: 'proxmox' } },
          child('docker', 'pve', 'docker_host'),
          child('grafana', 'docker'),
          makeNode('other'),
        ],
        edges: [{ id: 'e1', source: 'sw', target: 'pve', type: 'ethernet', data: { type: 'ethernet' } }],
      })
      render(<CanvasContainer />)
      hover(makeNode('sw'))
      expect(opacities(rfProps.nodes)).toEqual({ sw: 1, pve: 1, docker: 1, grafana: 1, other: 0.12 })
    })

    it('keeps the children of the hovered container itself lit', () => {
      useCanvasStore.setState({
        nodes: [makeNode('host'), child('c1', 'host'), child('c2', 'host'), makeNode('other')],
        edges: [],
      })
      render(<CanvasContainer />)
      hover(makeNode('host'))
      expect(opacities(rfProps.nodes)).toEqual({ host: 1, c1: 1, c2: 1, other: 0.12 })
    })

    it('does not light the members of a zone linked to the hovered node', () => {
      useCanvasStore.setState({
        nodes: [
          makeNode('sw'),
          { ...makeNode('zone'), type: 'groupRect', data: { ...makeNode('zone').data, type: 'groupRect' } },
          child('member', 'zone', 'server'),
        ],
        edges: [{ id: 'e1', source: 'sw', target: 'zone', type: 'ethernet', data: { type: 'ethernet' } }],
      })
      render(<CanvasContainer />)
      hover(makeNode('sw'))
      expect(opacities(rfProps.nodes)).toEqual({ sw: 1, zone: 1, member: 0.12 })
    })

    it('does nothing when the setting is off', () => {
      writeHoverHighlightSettings({ enabled: false })
      setupChain()
      hover(makeNode('n1'))
      expect(opacities(rfProps.nodes)).toEqual({ n1: undefined, n2: undefined, n3: undefined, n4: undefined })
      expect(opacities(rfProps.edges)).toEqual({ e12: undefined, e23: undefined })
    })

    it('follows the setting live, without a remount', () => {
      setupChain()
      hover(makeNode('n1'))
      act(() => writeHoverHighlightSettings({ enabled: false }))
      expect(opacities(rfProps.edges)).toEqual({ e12: undefined, e23: undefined })
      act(() => writeHoverHighlightSettings({ enabled: true }))
      expect(opacities(rfProps.edges)).toEqual({ e12: 1, e23: 0.08 })
    })

    it('clears an active highlight when the pointer moves onto a zone', () => {
      setupChain()
      hover(makeNode('n1'))
      hover({ ...makeNode('zone'), type: 'groupRect', data: { ...makeNode('zone').data, type: 'groupRect' } })
      expect(opacities(rfProps.edges)).toEqual({ e12: undefined, e23: undefined })
    })
  })
})

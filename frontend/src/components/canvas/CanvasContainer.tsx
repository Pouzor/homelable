import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  ControlButton,
  BackgroundVariant,
  ConnectionMode,
  SelectionMode,
  useReactFlow,
  type Node,
  type Edge,
  type Connection,
  type Viewport,
} from '@xyflow/react'
import { MousePointer2, Hand } from 'lucide-react'
import '@xyflow/react/dist/style.css'
import { useCanvasStore } from '@/stores/canvasStore'
import { useThemeStore } from '@/stores/themeStore'
import { THEMES } from '@/utils/themes'
import { computeCollapseInfo, rewireEdgesForCollapse } from '@/utils/collapseFilter'
import { nodeTypes } from './nodes/nodeTypes'
import { edgeTypes } from './edges/edgeTypes'
import { SearchBar } from './SearchBar'
import { AlignmentGuides } from './AlignmentGuides'
import { FloorMapLayer } from './FloorMapLayer'
import { useAlignmentGuides } from '@/hooks/useAlignmentGuides'
import { setViewportCenterProjector } from '@/utils/viewportCenter'
import type { NodeData, EdgeData } from '@/types'

interface CanvasContainerProps {
  onConnect?: (connection: Connection) => void
  onEdgeDoubleClick?: (edge: Edge<EdgeData>) => void
  onNodeDoubleClick?: (node: Node<NodeData>) => void
  onNodeDragStart?: () => void
  onRequestAddToGroup?: (payload: { nodeIds: string[]; groupId: string }) => void
  onRequestAddToContainer?: (payload: { nodeIds: string[]; containerId: string }) => void
  onRequestAddToZone?: (payload: { nodeIds: string[]; zoneId: string }) => void
  onOpenInventory?: (deviceId: string) => void
}

export function CanvasContainer({ onConnect: onConnectProp, onEdgeDoubleClick, onNodeDoubleClick, onNodeDragStart, onRequestAddToGroup, onRequestAddToContainer, onRequestAddToZone, onOpenInventory }: CanvasContainerProps) {
  const [lassoMode, setLassoMode] = useState(true)
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)
  const {
    nodes, edges,
    onNodesChange, onEdgesChange,
    setSelectedNode, snapshotHistory,
    fitViewPending, clearFitViewPending,
    savedViewport, setSavedViewport,
    copySelectedNodes, pasteNodes,
    removeNodesFromGroup,
  } = useCanvasStore()
  const { fitView, getViewport, screenToFlowPosition, getIntersectingNodes } = useReactFlow<Node<NodeData>>()

  // React Flow reads defaultViewport once, on mount. Leaving the canvas
  // (Documentation) unmounts it, so hold the stored pan/zoom as it was at first
  // render: later saves must not feed back into the prop.
  const [initialViewport] = useState(savedViewport)

  // Track the last cursor position over the canvas so paste lands under it.
  const cursorRef = useRef<{ x: number; y: number } | null>(null)
  const onMouseMove = useCallback((e: React.MouseEvent) => {
    cursorRef.current = { x: e.clientX, y: e.clientY }
  }, [])

  // Expose the visible-canvas centre (in flow coords) to add-node handlers that
  // live outside ReactFlowProvider, so new nodes land where the user is looking.
  const wrapperRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    setViewportCenterProjector(() => {
      const rect = wrapperRef.current?.getBoundingClientRect()
      const screen = rect
        ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
        : { x: window.innerWidth / 2, y: window.innerHeight / 2 }
      return screenToFlowPosition(screen)
    })
    return () => setViewportCenterProjector(null)
  }, [screenToFlowPosition])

  // Copy / paste shortcuts. Registered here (inside ReactFlowProvider) so paste
  // can project the cursor / viewport center into flow coordinates.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      const el = e.target as HTMLElement
      const isInput = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable
      if (isInput) return
      if (e.key === 'c') {
        copySelectedNodes()
      } else if (e.key === 'v') {
        const screen = cursorRef.current ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 }
        pasteNodes(screenToFlowPosition(screen))
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [copySelectedNodes, pasteNodes, screenToFlowPosition])

  // Fit view after canvas loads (fitViewPending is set by loadCanvas)
  useEffect(() => {
    if (!fitViewPending || nodes.length === 0) return
    const id = setTimeout(() => {
      void fitView({ padding: 0.12, duration: 350 }).then(() => {
        // Where the fit landed is the viewport to come back to.
        setSavedViewport(getViewport())
      })
      clearFitViewPending()
    }, 50)
    return () => clearTimeout(id)
  }, [fitViewPending, nodes.length, fitView, getViewport, setSavedViewport, clearFitViewPending])

  const activeTheme = useThemeStore((s) => s.activeTheme)
  const theme = THEMES[activeTheme]

  // Filter nodes and edges based on collapsed state (memoized — O(n)).
  const collapseInfo = useMemo(() => computeCollapseInfo(nodes), [nodes])
  const visibleNodes = useMemo(
    () => nodes.filter((n) => collapseInfo.visibleIds.has(n.id)),
    [nodes, collapseInfo],
  )
  const visibleEdges = useMemo(
    () => rewireEdgesForCollapse(edges, nodes, collapseInfo.visibleIds, collapseInfo.hiddenBy),
    [edges, nodes, collapseInfo],
  )

  // Hover highlight: dim nodes and edges not connected to the hovered node.
  const hoveredConnected = useMemo(() => {
    if (!hoveredNodeId) return null
    const nodeIds = new Set<string>([hoveredNodeId])
    const edgeIds = new Set<string>()
    for (const e of visibleEdges) {
      if (e.source === hoveredNodeId || e.target === hoveredNodeId) {
        edgeIds.add(e.id)
        nodeIds.add(e.source)
        nodeIds.add(e.target)
      }
    }
    return { nodeIds, edgeIds }
  }, [hoveredNodeId, visibleEdges])

  const displayNodes = useMemo(
    () => hoveredConnected
      ? visibleNodes.map((n) => ({
          ...n,
          style: { ...n.style, opacity: hoveredConnected.nodeIds.has(n.id) ? 1 : 0.12, transition: 'opacity 0.15s' },
        }))
      : visibleNodes,
    [visibleNodes, hoveredConnected],
  )

  const displayEdges = useMemo(
    () => hoveredConnected
      ? visibleEdges.map((e) => ({
          ...e,
          style: { ...e.style, opacity: hoveredConnected.edgeIds.has(e.id) ? 1 : 0.08, transition: 'opacity 0.15s' },
        }))
      : visibleEdges,
    [visibleEdges, hoveredConnected],
  )

  const onNodeClick = useCallback((e: React.MouseEvent, node: Node<NodeData>) => {
    if (e.ctrlKey || e.metaKey) {
      setSelectedNode(null)
    } else {
      setSelectedNode(node.id)
    }
  }, [setSelectedNode])

  const onPaneClick = useCallback(() => {
    setSelectedNode(null)
  }, [setSelectedNode])

  // Every pan / zoom the user ends is remembered, so leaving the canvas and
  // coming back does not reset the view to 1:1 at the origin.
  const handleMoveEnd = useCallback((_: unknown, viewport: Viewport) => {
    setSavedViewport(viewport)
  }, [setSavedViewport])

  const handleEdgeDoubleClick = useCallback((_: React.MouseEvent, edge: Edge<EdgeData>) => {
    onEdgeDoubleClick?.(edge)
  }, [onEdgeDoubleClick])

  const handleNodeDoubleClick = useCallback((_: React.MouseEvent, node: Node<NodeData>) => {
    onNodeDoubleClick?.(node)
  }, [onNodeDoubleClick])

  const handleBeforeDelete = useCallback(async () => {
    snapshotHistory()
    return true
  }, [snapshotHistory])

  const isValidConnection = useCallback(
    (connection: { source: string | null; target: string | null }) => connection.source !== connection.target,
    []
  )

  const handleNodeMouseEnter = useCallback((_: React.MouseEvent, node: Node<NodeData>) => {
    setHoveredNodeId(node.id)
  }, [])

  const handleNodeMouseLeave = useCallback(() => {
    setHoveredNodeId(null)
  }, [])

  const { guides, onNodeDrag, onNodeDragStop } = useAlignmentGuides()

  // Drop a selection onto a group → ask App to confirm adding it. Runs before
  // the alignment snap so detection uses the dropped position. `dragNodes` is
  // the whole multi-selection being dragged; `dragNode` (the one under the
  // cursor) only picks the destination.
  const handleNodeDragStop = useCallback<NonNullable<typeof onNodeDragStop>>((event, dragNode, dragNodes) => {
    // A single drag reports an empty `dragNodes` in some React Flow paths, so
    // fall back to the dragged node itself.
    const dragged = dragNodes && dragNodes.length > 0 ? dragNodes : dragNode ? [dragNode] : []
    // Groups and zones are containers, never contents.
    const movable = dragged.filter((n) => n.data.type !== 'group' && n.data.type !== 'groupRect')

    if (dragNode && dragNode.data.type !== 'group' && dragNode.data.type !== 'groupRect' && movable.length > 0) {
      const intersecting = getIntersectingNodes(dragNode)
      const zoneParent = dragNode.parentId
        ? nodes.find((n) => n.id === dragNode.parentId && n.data.type === 'groupRect')
        : undefined
      if (zoneParent) {
        // Zone children are not extent-clamped, so a drop outside the zone is
        // how the user takes a node back out of it. The whole selection leaves
        // with it, not only the node under the cursor.
        if (!intersecting.some((n) => n.id === zoneParent.id)) {
          const leaving = movable.filter((n) => n.parentId === zoneParent.id).map((n) => n.id)
          // One history entry, so a single undo puts the whole selection back —
          // symmetric with the batched add.
          removeNodesFromGroup(zoneParent.id, leaving)
        }
      } else if (!dragNode.parentId) {
        // Only free nodes join a new parent; one already nested elsewhere in the
        // selection keeps its own parent.
        const nodeIds = movable.filter((n) => !n.parentId).map((n) => n.id)
        const group = intersecting.find((n) => n.data.type === 'group')
        const container = intersecting.find((n) => n.id !== dragNode.id && n.data.container_mode === true)
        // The destination can be part of the dragged selection (lasso over
        // everything); it cannot also be one of its own new children.
        const targetless = (targetId: string) => nodeIds.filter((id) => id !== targetId)
        if (group) {
          const ids = targetless(group.id)
          if (ids.length > 0) onRequestAddToGroup?.({ nodeIds: ids, groupId: group.id })
        } else if (container) {
          // Any node in container_mode (proxmox, docker_host, …) accepts children.
          const ids = targetless(container.id)
          if (ids.length > 0) onRequestAddToContainer?.({ nodeIds: ids, containerId: container.id })
        } else {
          // Zones come last: they are the loosest container and the largest, so
          // a group/container inside one still wins the drop.
          const zone = intersecting.find((n) => n.data.type === 'groupRect')
          if (zone) {
            const ids = targetless(zone.id)
            if (ids.length > 0) onRequestAddToZone?.({ nodeIds: ids, zoneId: zone.id })
          }
        }
      }
    }
    onNodeDragStop(event, dragNode, dragNodes)
  }, [onRequestAddToGroup, onRequestAddToContainer, onRequestAddToZone, removeNodesFromGroup, nodes, getIntersectingNodes, onNodeDragStop])

  return (
    <div ref={wrapperRef} className="w-full h-full" style={{ background: theme.colors.canvasBackground }} onMouseMove={onMouseMove}>
      <ReactFlow
        nodes={displayNodes}
        edges={displayEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnectProp}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        onEdgeDoubleClick={handleEdgeDoubleClick}
        onNodeDoubleClick={handleNodeDoubleClick}
        onNodeDragStart={onNodeDragStart}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={handleNodeDragStop}
        onMoveEnd={handleMoveEnd}
        defaultViewport={initialViewport ?? undefined}
        onNodeMouseEnter={handleNodeMouseEnter}
        onNodeMouseLeave={handleNodeMouseLeave}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        deleteKeyCode={['Backspace', 'Delete']}
        onBeforeDelete={handleBeforeDelete}
        selectionOnDrag={lassoMode}
        panOnDrag={lassoMode ? [1, 2] : true}
        panActivationKeyCode="Space"
        selectionMode={SelectionMode.Partial}
        multiSelectionKeyCode={['Meta', 'Control']}
        minZoom={0.25}
        maxZoom={2.5}
        snapToGrid
        snapGrid={[8, 8]}
        colorMode={theme.colors.reactFlowColorMode}
        elevateNodesOnSelect={false}
        connectionMode={ConnectionMode.Loose}
        connectionRadius={30}
        isValidConnection={isValidConnection}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={16}
          size={1}
          color={theme.colors.canvasDotColor}
        />
        <FloorMapLayer />
        <SearchBar onOpenInventory={onOpenInventory} />
        <AlignmentGuides guides={guides} />
        <Controls>
          <ControlButton
            onClick={() => setLassoMode((m) => !m)}
            title={lassoMode ? 'Switch to pan mode (Space to pan)' : 'Switch to lasso mode'}
          >
            {lassoMode ? <MousePointer2 size={12} /> : <Hand size={12} />}
          </ControlButton>
        </Controls>
      </ReactFlow>
    </div>
  )
}

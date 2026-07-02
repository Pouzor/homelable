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
import { useAlignmentGuides } from '@/hooks/useAlignmentGuides'
import { setViewportCenterProjector } from '@/utils/viewportCenter'
import type { NodeData, EdgeData } from '@/types'

interface CanvasContainerProps {
  onConnect?: (connection: Connection) => void
  onEdgeDoubleClick?: (edge: Edge<EdgeData>) => void
  onNodeDoubleClick?: (node: Node<NodeData>) => void
  onNodeDragStart?: () => void
  onRequestAddToGroup?: (payload: { nodeId: string; groupId: string }) => void
  onRequestAddToContainer?: (payload: { nodeId: string; containerId: string }) => void
  onOpenPending?: (deviceId: string) => void
}

export function CanvasContainer({ onConnect: onConnectProp, onEdgeDoubleClick, onNodeDoubleClick, onNodeDragStart, onRequestAddToGroup, onRequestAddToContainer, onOpenPending }: CanvasContainerProps) {
  const [lassoMode, setLassoMode] = useState(true)
  const {
    nodes, edges,
    onNodesChange, onEdgesChange,
    setSelectedNode, snapshotHistory,
    fitViewPending, clearFitViewPending,
    copySelectedNodes, pasteNodes,
  } = useCanvasStore()
  const { fitView, screenToFlowPosition, getIntersectingNodes } = useReactFlow<Node<NodeData>>()

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
      fitView({ padding: 0.12, duration: 350 })
      clearFitViewPending()
    }, 50)
    return () => clearTimeout(id)
  }, [fitViewPending, nodes.length, fitView, clearFitViewPending])

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

  const { guides, onNodeDrag, onNodeDragStop } = useAlignmentGuides()

  // Drop a top-level node onto a group → ask App to confirm adding it. Runs
  // before the alignment snap so detection uses the dropped position.
  const handleNodeDragStop = useCallback<NonNullable<typeof onNodeDragStop>>((event, dragNode, dragNodes) => {
    if (dragNode && !dragNode.parentId &&
        dragNode.data.type !== 'group' && dragNode.data.type !== 'groupRect') {
      const intersecting = getIntersectingNodes(dragNode)
      const group = intersecting.find((n) => n.data.type === 'group')
      if (group) {
        onRequestAddToGroup?.({ nodeId: dragNode.id, groupId: group.id })
      } else {
        // Any node in container_mode (proxmox, docker_host, …) accepts children.
        const container = intersecting.find((n) => n.id !== dragNode.id && n.data.container_mode === true)
        if (container) onRequestAddToContainer?.({ nodeId: dragNode.id, containerId: container.id })
      }
    }
    onNodeDragStop(event, dragNode, dragNodes)
  }, [onRequestAddToGroup, onRequestAddToContainer, getIntersectingNodes, onNodeDragStop])

  return (
    <div ref={wrapperRef} className="w-full h-full" style={{ background: theme.colors.canvasBackground }} onMouseMove={onMouseMove}>
      <ReactFlow
        nodes={visibleNodes}
        edges={visibleEdges}
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
        isValidConnection={isValidConnection}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={16}
          size={1}
          color={theme.colors.canvasDotColor}
        />
        <SearchBar onOpenPending={onOpenPending} />
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

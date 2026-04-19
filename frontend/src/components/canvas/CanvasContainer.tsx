import { useCallback, useEffect, useState } from 'react'
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
import { nodeTypes } from './nodes/nodeTypes'
import { edgeTypes } from './edges/edgeTypes'
import { SearchBar } from './SearchBar'
import type { NodeData, EdgeData } from '@/types'

interface CanvasContainerProps {
  onConnect?: (connection: Connection) => void
  onEdgeDoubleClick?: (edge: Edge<EdgeData>) => void
  onNodeDoubleClick?: (node: Node<NodeData>) => void
  onNodeDragStart?: () => void
  onOpenPending?: (deviceId: string) => void
}

export function CanvasContainer({ onConnect: onConnectProp, onEdgeDoubleClick, onNodeDoubleClick, onNodeDragStart, onOpenPending }: CanvasContainerProps) {
  const [lassoMode, setLassoMode] = useState(true)
  const {
    nodes, edges,
    onNodesChange, onEdgesChange,
    setSelectedNode, snapshotHistory,
    fitViewPending, clearFitViewPending,
  } = useCanvasStore()
  const { fitView } = useReactFlow()

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

  return (
    <div className="w-full h-full" style={{ background: theme.colors.canvasBackground }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnectProp}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        onEdgeDoubleClick={handleEdgeDoubleClick}
        onNodeDoubleClick={handleNodeDoubleClick}
        onNodeDragStart={onNodeDragStart}
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

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
  onNodeDragStart?: () => void
  onOpenPending?: (deviceId: string) => void
}

export function CanvasContainer({ onConnect: onConnectProp, onEdgeDoubleClick, onNodeDragStart, onOpenPending }: CanvasContainerProps) {
  const [lassoMode, setLassoMode] = useState(true)
  const {
    nodes, edges,
    onNodesChange, onEdgesChange,
    setSelectedNode, snapshotHistory,
    fitViewPending, clearFitViewPending,
    updateNode
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

  const handleNodeDragStop = useCallback((_: React.MouseEvent, draggedNode: Node<NodeData>) => {
    // Only look for intersection if it's a loose node (no parent)
    if (!draggedNode.parentId) {
      // Temporarily cast to 'any' to read positionAbsolute, 
      // or fallback to default React Flow 'position'
      const dNode = draggedNode as any;
      const draggedX = dNode.positionAbsolute?.x ?? draggedNode.position.x;
      const draggedY = dNode.positionAbsolute?.y ?? draggedNode.position.y;

      // Find all proxmox containers EXCEPT the dragged node itself
      const containers = nodes.filter(
        (n) => n.data.type === 'proxmox' && n.data.container_mode && n.id !== draggedNode.id
      );

      // Mathematically check if the node was dropped inside any container
      const targetContainer = containers.find((container) => {
        const cNode = container as any;
        const cX = cNode.positionAbsolute?.x ?? container.position.x;
        const cY = cNode.positionAbsolute?.y ?? container.position.y;
        const cWidth = container.width ?? 0;
        const cHeight = container.height ?? 0;

        return (
          draggedX >= cX &&
          draggedX <= cX + cWidth &&
          draggedY >= cY &&
          draggedY <= cY + cHeight
        );
      });

      if (targetContainer) {
        updateNode(draggedNode.id, { parent_id: targetContainer.id });
      }
    }
  }, [nodes, updateNode]);
 
  const handleEdgeDoubleClick = useCallback((_: React.MouseEvent, edge: Edge<EdgeData>) => {
    onEdgeDoubleClick?.(edge)
  }, [onEdgeDoubleClick])

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
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={handleNodeDragStop}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        deleteKeyCode={['Backspace', 'Delete']}
        onBeforeDelete={async () => { snapshotHistory(); return true }}
        selectionOnDrag={lassoMode}
        panOnDrag={lassoMode ? [1, 2] : true}
        panActivationKeyCode="Space"
        selectionMode={SelectionMode.Partial}
        multiSelectionKeyCode={['Meta', 'Control']}
        snapToGrid
        snapGrid={[8, 8]}
        colorMode={theme.colors.reactFlowColorMode}
        elevateNodesOnSelect={false}
        connectionMode={ConnectionMode.Loose}
        isValidConnection={(connection) => connection.source !== connection.target}
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

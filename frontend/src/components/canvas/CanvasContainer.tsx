import { useCallback, useMemo } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
  type Node,
  type Edge,
  type Connection,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useCanvasStore } from '@/stores/canvasStore'
import { nodeTypes } from './nodes/nodeTypes'
import { edgeTypes } from './edges/edgeTypes'
import type { NodeData, EdgeData } from '@/types'

interface CanvasContainerProps {
  onConnect?: (connection: Connection) => void
  onEdgeDoubleClick?: (edge: Edge<EdgeData>) => void
}

export function CanvasContainer({ onConnect: onConnectProp, onEdgeDoubleClick }: CanvasContainerProps) {
  const {
    nodes, edges,
    onNodesChange, onEdgesChange,
    setSelectedNode,
  } = useCanvasStore()

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node<NodeData>) => {
    setSelectedNode(node.id)
  }, [setSelectedNode])

  const onPaneClick = useCallback(() => {
    setSelectedNode(null)
  }, [setSelectedNode])

  const handleEdgeDoubleClick = useCallback((_: React.MouseEvent, edge: Edge<EdgeData>) => {
    onEdgeDoubleClick?.(edge)
  }, [onEdgeDoubleClick])

  // Hide edges between a container-mode proxmox and its direct children
  const visibleEdges = useMemo(() => {
    const containerIds = new Set(
      nodes
        .filter((n) => n.type === 'proxmox' && n.data.container_mode !== false)
        .map((n) => n.id)
    )
    const childParentMap = new Map(
      nodes.filter((n) => n.data.parent_id).map((n) => [n.id, n.data.parent_id as string])
    )
    return (edges as Edge<EdgeData>[]).filter((e) => {
      if (containerIds.has(e.source) && childParentMap.get(e.target) === e.source) return false
      if (containerIds.has(e.target) && childParentMap.get(e.source) === e.target) return false
      return true
    })
  }, [nodes, edges])

  return (
    <div className="w-full h-full">
      <ReactFlow
        nodes={nodes}
        edges={visibleEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnectProp}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        onEdgeDoubleClick={handleEdgeDoubleClick}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        snapToGrid
        snapGrid={[16, 16]}
        fitView
        colorMode="dark"
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={24}
          size={1}
          color="#30363d"
        />
        <Controls />
        <MiniMap
          nodeColor={(node) => {
            const data = node.data as NodeData
            const colorMap: Record<string, string> = {
              online: '#39d353',
              offline: '#f85149',
              pending: '#e3b341',
              unknown: '#8b949e',
            }
            return colorMap[data?.status ?? 'unknown']
          }}
          maskColor="rgba(13, 17, 23, 0.7)"
        />
      </ReactFlow>
    </div>
  )
}

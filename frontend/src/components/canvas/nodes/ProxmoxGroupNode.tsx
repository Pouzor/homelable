import { Handle, Position, NodeResizer, type NodeProps, type Node } from '@xyflow/react'
import { Layers } from 'lucide-react'
import type { NodeData, NodeStatus } from '@/types'
import { BaseNode } from './BaseNode'

const STATUS_COLORS: Record<NodeStatus, string> = {
  online: '#39d353',
  offline: '#f85149',
  pending: '#e3b341',
  unknown: '#8b949e',
}

const GLOW = '#ff6e00'

export function ProxmoxGroupNode(props: NodeProps<Node<NodeData>>) {
  const { data, selected } = props

  // Render as a regular node when container mode is disabled
  if (data.container_mode === false) {
    return <BaseNode {...props} icon={Layers} glowColor={GLOW} />
  }

  const statusColor = STATUS_COLORS[data.status]
  const isOnline = data.status === 'online'

  return (
    <>
      <NodeResizer
        minWidth={220}
        minHeight={160}
        isVisible={selected}
        lineStyle={{ borderColor: GLOW, opacity: 0.6 }}
        handleStyle={{ borderColor: GLOW, backgroundColor: '#21262d' }}
      />

      {/* Group border */}
      <div
        className="w-full h-full rounded-xl border-2 flex flex-col overflow-hidden"
        style={{
          borderColor: selected ? GLOW : isOnline ? `${GLOW}66` : '#30363d',
          background: isOnline ? `${GLOW}08` : '#0d111766',
          boxShadow: isOnline
            ? `0 0 20px ${GLOW}1a, inset 0 0 40px ${GLOW}08`
            : selected
            ? `0 0 12px ${GLOW}33`
            : 'none',
        }}
      >
        {/* Header bar */}
        <div
          className="flex items-center gap-2 px-2.5 py-1.5 shrink-0"
          style={{ background: isOnline ? `${GLOW}18` : '#161b2288', borderBottom: `1px solid ${isOnline ? `${GLOW}33` : '#30363d'}` }}
        >
          <div
            className="flex items-center justify-center w-5 h-5 rounded-md shrink-0"
            style={{ color: isOnline ? GLOW : '#8b949e', background: '#161b22' }}
          >
            <Layers size={12} />
          </div>
          <div className="flex flex-col min-w-0 flex-1">
            <span className="text-[11px] font-semibold leading-tight truncate" style={{ color: isOnline ? GLOW : '#c9d1d9' }}>
              {data.label}
            </span>
            {data.ip && (
              <span className="font-mono text-[9px] text-[#8b949e] truncate">{data.ip}</span>
            )}
          </div>
          {/* Status dot */}
          <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: statusColor }} title={data.status} />
        </div>

        {/* Inner area — React Flow places children here */}
        <div className="flex-1 relative" />
      </div>

      <Handle type="target" position={Position.Top} className="!bg-[#30363d] !border-[#8b949e]" />
      <Handle type="source" position={Position.Bottom} className="!bg-[#30363d] !border-[#8b949e]" />
    </>
  )
}

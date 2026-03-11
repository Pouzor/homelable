import { createElement } from 'react'
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import { type LucideIcon } from 'lucide-react'
import type { NodeData } from '@/types'
import { resolveNodeColors } from '@/utils/nodeColors'
import { resolveNodeIcon } from '@/utils/nodeIcons'
import { useThemeStore } from '@/stores/themeStore'
import { THEMES } from '@/utils/themes'

interface BaseNodeProps extends NodeProps<Node<NodeData>> {
  icon: LucideIcon
}

export function BaseNode({ data, selected, icon: typeIcon }: BaseNodeProps) {
  const activeTheme = useThemeStore((s) => s.activeTheme)
  const theme = THEMES[activeTheme]

  const resolvedIcon = resolveNodeIcon(typeIcon, data.custom_icon)
  const colors = resolveNodeColors(data, activeTheme)
  const statusColor = theme.colors.statusColors[data.status]
  const isOnline = data.status === 'online'

  return (
    <div
      className="relative flex flex-row items-center gap-2.5 px-2.5 py-2 rounded-lg border transition-all duration-200"
      style={{
        background: colors.background,
        borderColor: colors.border,
        borderWidth: selected ? 2 : 1,
        boxShadow: isOnline
          ? `0 0 10px ${colors.border}2e, 0 0 3px ${colors.border}1a`
          : selected
          ? `0 0 8px ${colors.border}44`
          : 'none',
        opacity: data.status === 'offline' ? 0.55 : 1,
        minWidth: 140,
      }}
    >
      <Handle
        type="source"
        position={Position.Top}
        id="top"
        style={{ background: theme.colors.handleBackground, borderColor: theme.colors.handleBorder }}
      />
      <Handle type="target" position={Position.Top} id="top-t" style={{ opacity: 0, width: 12, height: 12 }} />

      {/* Icon */}
      <div
        className="flex items-center justify-center w-7 h-7 rounded-md shrink-0"
        style={{
          color: isOnline ? colors.icon : theme.colors.nodeSubtextColor,
          background: theme.colors.nodeIconBackground,
        }}
      >
        {createElement(resolvedIcon, { size: 15 })}
      </div>

      {/* Details */}
      <div className="flex flex-col min-w-0">
        <div
          className="text-xs font-medium leading-tight truncate max-w-[110px]"
          style={{ color: theme.colors.nodeLabelColor }}
          title={data.label}
        >
          {data.label}
        </div>
        {data.ip && (
          <div
            className="font-mono text-[10px] truncate"
            style={{ color: theme.colors.nodeSubtextColor }}
            title={data.ip}
          >
            {data.ip}
          </div>
        )}
      </div>

      {/* Status dot */}
      <div
        className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full shrink-0"
        style={{ backgroundColor: statusColor }}
        title={data.status}
      />

      <Handle
        type="source"
        position={Position.Bottom}
        id="bottom"
        style={{ background: theme.colors.handleBackground, borderColor: theme.colors.handleBorder }}
      />
      <Handle type="target" position={Position.Bottom} id="bottom-t" style={{ opacity: 0, width: 12, height: 12 }} />
    </div>
  )
}

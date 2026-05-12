import { createElement } from 'react'
import { Handle, Position, NodeResizer, type NodeProps, type Node } from '@xyflow/react'
import { Layers } from 'lucide-react'
import type { NodeData } from '@/types'
import { resolveNodeColors } from '@/utils/nodeColors'
import { resolveNodeIcon, isBrandIconKey } from '@/utils/nodeIcons'
import { NodeIcon } from '@/components/ui/NodeIcon'
import { resolvePropertyIcon } from '@/utils/propertyIcons'
import { useCanvasStore } from '@/stores/canvasStore'
import { maskIp, splitIps } from '@/utils/maskIp'
import { useThemeStore } from '@/stores/themeStore'
import { THEMES } from '@/utils/themes'
import { BaseNode } from './BaseNode'

export function ProxmoxGroupNode(props: NodeProps<Node<NodeData>>) {
  const { data, selected } = props

  const activeTheme = useThemeStore((s) => s.activeTheme)
  const hideIp = useCanvasStore((s) => s.hideIp)
  const theme = THEMES[activeTheme]
  const colors = resolveNodeColors(data, activeTheme)

  // Render as a regular node when container mode is disabled
  if (data.container_mode === false) {
    const proxmoxAccent = theme.colors.nodeAccents.proxmox.border
    return (
      <>
        <BaseNode {...props} icon={Layers} />
        <Handle
          type="source"
          position={Position.Left}
          id="cluster-left"
          title="Same cluster"
          style={{ background: proxmoxAccent, borderColor: `${proxmoxAccent}88`, width: 6, height: 6 }}
        />
        <Handle
          type="source"
          position={Position.Right}
          id="cluster-right"
          title="Same cluster"
          style={{ background: proxmoxAccent, borderColor: `${proxmoxAccent}88`, width: 6, height: 6 }}
        />
      </>
    )
  }

  const statusColor = theme.colors.statusColors[data.status]
  const isOnline = data.status === 'online'
  const glow = colors.border
  const proxmoxAccent = theme.colors.nodeAccents.proxmox.border
  const resolvedIcon = resolveNodeIcon(Layers, data.custom_icon)

  return (
    <>
      <NodeResizer
        minWidth={220}
        minHeight={160}
        isVisible={selected}
        lineStyle={{ borderColor: 'transparent' }}
        handleStyle={{ borderColor: glow, backgroundColor: colors.border, width: 10, height: 10 }}
      />

      {/* Group border */}
      <div
        className="w-full h-full rounded-lg border-2 flex flex-col overflow-hidden"
        style={{
          borderColor: selected ? glow : `${glow}88`,
          background: isOnline ? `${colors.background}cc` : `${colors.background}aa`,
          boxShadow: isOnline
            ? `0 0 20px ${glow}1a, inset 0 0 40px ${glow}08`
            : selected
            ? `0 0 12px ${glow}33`
            : 'none',
        }}
      >
        {/* Header bar */}
        <div
          className="flex flex-row items-start gap-2 px-2.5 py-1.5 shrink-0"
          style={{
            background: isOnline ? `${glow}18` : `${theme.colors.nodeIconBackground}88`,
            borderBottom: `1px solid ${isOnline ? `${glow}33` : theme.colors.handleBackground}`,
          }}
        >
          <div
            className="flex items-center justify-center w-7 h-7 rounded-md shrink-0"
            style={{
              color: isOnline ? colors.icon : theme.colors.nodeSubtextColor,
              background: theme.colors.nodeIconBackground,
            }}
          >
            {isBrandIconKey(data.custom_icon)
              ? <NodeIcon typeIcon={Layers} customIconKey={data.custom_icon} size={12} />
              : createElement(resolvedIcon, { size: 15 })}
          </div>
          <div className="flex flex-col min-w-0">
            <div
              className="text-xs font-semibold leading-tight truncate"
              style={{ color: isOnline ? glow : theme.colors.nodeLabelColor }}
              title={data.label}
            >
              {data.label}
            </div>
            {data.ip && splitIps(data.ip).map((ip) => (
              <div
                key={ip}
                className="font-mono text-[9px] truncate"
                style={{ color: theme.colors.nodeSubtextColor }}
              >
                {hideIp ? maskIp(ip) : ip}
              </div>
            ))}
          </div>
          {/* Status dot */}
          <div
            className="ml-auto w-1.5 h-1.5 rounded-full shrink-0"
            style={{ backgroundColor: statusColor }}
            title={data.status}
          />
        </div>

        {/* Properties */}
        {data.properties?.filter((p) => p.visible).map((prop, i, arr) => {
          const Icon = resolvePropertyIcon(prop.icon)
          return (
            <div
              key={prop.key}
              className="flex items-center gap-1 font-mono text-[10px] min-w-0 overflow-hidden px-2.5 shrink-0"
              style={{
                color: theme.colors.nodeSubtextColor,
                paddingTop: i === 0 ? 4 : 2,
                paddingBottom: i === arr.length - 1 ? 4 : 2,
                borderTop: i === 0 ? `1px solid ${glow}22` : undefined,
              }}
            >
              {Icon && <Icon size={9} className="shrink-0" />}
              <span className="truncate max-w-15 shrink-0" title={prop.key}>{prop.key}</span>
              <span className="truncate min-w-0" title={prop.value}>· {prop.value}</span>
            </div>
          )
        })}

        {/* Inner area — React Flow places children here */}
        <div className="flex-1 relative" />
      </div>

      <Handle
        type="source"
        position={Position.Top}
        id="top"
        style={{ background: theme.colors.handleBackground, borderColor: theme.colors.handleBorder }}
      />
      <Handle type="target" position={Position.Top} id="top-t" style={{ opacity: 0, width: 12, height: 12 }} />
      <Handle
        type="source"
        position={Position.Bottom}
        id="bottom"
        style={{ background: theme.colors.handleBackground, borderColor: theme.colors.handleBorder }}
      />
      <Handle type="target" position={Position.Bottom} id="bottom-t" style={{ opacity: 0, width: 12, height: 12 }} />

      {/* Cluster handles */}
      <Handle
        type="source"
        position={Position.Left}
        id="cluster-left"
        title="Same cluster"
        style={{ background: proxmoxAccent, borderColor: `${proxmoxAccent}88`, width: 6, height: 6 }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="cluster-right"
        title="Same cluster"
        style={{ background: proxmoxAccent, borderColor: `${proxmoxAccent}88`, width: 6, height: 6 }}
      />
    </>
  )
}

import { createElement } from 'react'
import { Handle, Position, NodeResizer, type NodeProps, type Node } from '@xyflow/react'
import { Layers } from 'lucide-react'
import type { NodeData } from '@/types'
import { resolveNodeColors } from '@/utils/nodeColors'
import { resolveNodeIcon } from '@/utils/nodeIcons'
import { resolvePropertyIcon } from '@/utils/propertyIcons'
import { useThemeStore } from '@/stores/themeStore'
import { THEMES } from '@/utils/themes'
import { BaseNode } from './BaseNode'

export function ProxmoxGroupNode(props: NodeProps<Node<NodeData>>) {
  const { data, selected } = props

  const activeTheme = useThemeStore((s) => s.activeTheme)
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
        lineStyle={{ borderColor: glow, opacity: 0.6 }}
        handleStyle={{ borderColor: glow, backgroundColor: theme.colors.nodeCardBackground }}
      />

      {/* Group border */}
      <div
        className="w-full h-full rounded-xl border-2 flex flex-col overflow-hidden"
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
          className="flex flex-col gap-1 px-2.5 py-1.5 shrink-0"
          style={{
            background: isOnline ? `${glow}18` : `${theme.colors.nodeIconBackground}88`,
            borderBottom: `2px solid ${isOnline ? `${glow}33` : theme.colors.handleBackground}`,
          }}
        >
          {/* Rest of header bar (icon, label, ip/hostname, status dot) */}
          <div className="flex items-center gap-2 min-w-0">
            <a
              href={data.ip ? `${data.port ? `http://${data.ip}:${data.port}` : `http://${data.ip}`}` : undefined}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center w-5 h-5 rounded-md shrink-0 focus:outline-none"
              style={{
                color: isOnline ? colors.icon : theme.colors.nodeSubtextColor,
                background: theme.colors.nodeIconBackground,
                cursor: data.ip ? 'pointer' : 'default',
                textDecoration: 'none',
              }}
              title={data.ip ? `Open ${data.ip}${data.port ? `:${data.port}` : ''}` : undefined}
              tabIndex={0}
            >
              {createElement(resolvedIcon, { size: 12 })}
            </a>
            <div className="flex flex-col min-w-0 flex-1">
              <span
                className="text-[11px] font-semibold leading-tight truncate"
                style={{ color: isOnline ? glow : theme.colors.nodeLabelColor }}
              >
                {data.label}
              </span>
              {data.ip && (
                <span className="font-mono text-[9px] flex gap-1 items-center flex-wrap" style={{ color: theme.colors.nodeSubtextColor }}>
                  <a
                    href={`http://${data.ip}${data.port ? `:${data.port}` : ''}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:underline focus:outline-none"
                    style={{ cursor: 'pointer', color: theme.colors.nodeSubtextColor }}
                    tabIndex={0}
                    title={`Open ${data.ip}${data.port ? `:${data.port}` : ''}`}
                  >
                    {data.ip}{data.port ? `:${data.port}` : ''}
                  </a>
                  {data.hostname && (
                    <>
                      <span aria-hidden="true">|</span>
                      <a
                        href={`http://${data.hostname}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:underline focus:outline-none"
                        style={{ cursor: 'pointer', color: theme.colors.nodeSubtextColor }}
                        tabIndex={0}
                        title={`Open ${data.hostname}`}
                      >
                        {data.hostname}
                      </a>
                    </>
                  )}
                </span>
              )}
            </div>
            {/* Status dot */}
            <div
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{ backgroundColor: statusColor }}
              title={data.status}
            />
          </div>
          {/* Properties row */}
          {Array.isArray(data.properties) && data.properties.filter((p) => p.visible).length > 0 && (
            <div className="flex flex-row flex-wrap gap-2 w-full">
              {data.properties.filter((p) => p.visible).map((prop) => {
                const Icon = resolvePropertyIcon(prop.icon)
                return (
                  <span key={prop.key} className="flex items-center gap-1 font-mono text-[10px]" style={{ color: theme.colors.nodeSubtextColor }}>
                    {Icon && <Icon size={9} className="shrink-0" />}
                    <span>{prop.key}</span>
                    <span>· {prop.value}</span>
                  </span>
                )
              })}
            </div>
          )}
        </div>

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

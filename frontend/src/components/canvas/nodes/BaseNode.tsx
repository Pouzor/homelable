import { createElement, useEffect, useMemo } from 'react'
import { Handle, Position, NodeResizer, useUpdateNodeInternals, useViewport, type NodeProps, type Node } from '@xyflow/react'
import { Cpu, MemoryStick, HardDrive, type LucideIcon } from 'lucide-react'
import type { NodeData } from '@/types'
import { resolveNodeColors } from '@/utils/nodeColors'
import { resolveNodeIcon } from '@/utils/nodeIcons'
import { resolvePropertyIcon } from '@/utils/propertyIcons'
import { useThemeStore } from '@/stores/themeStore'
import { THEMES } from '@/utils/themes'
import { useCanvasStore } from '@/stores/canvasStore'
import { maskIp, splitIps } from '@/utils/maskIp'
import { bottomHandleId, bottomHandlePositions, clampBottomHandles } from '@/utils/handleUtils'

interface BaseNodeProps extends NodeProps<Node<NodeData>> {
  icon: LucideIcon
}

function formatStorage(gb: number): string {
  if (gb >= 1024) return `${(gb / 1024).toFixed(1).replace(/\.0$/, '')} TB`
  return `${gb} GB`
}

export function BaseNode({ id, data, selected, icon: typeIcon, width, height }: BaseNodeProps) {
  const updateNodeInternals = useUpdateNodeInternals()
  useEffect(() => { updateNodeInternals(id) }, [data.bottom_handles, id, updateNodeInternals])

  const { zoom } = useViewport()
  const borderWidth = useMemo(() => Math.max(1, 1 / zoom), [zoom])

  const activeTheme = useThemeStore((s) => s.activeTheme)
  const hideIp = useCanvasStore((s) => s.hideIp)
  const theme = THEMES[activeTheme]

  const resolvedIcon = resolveNodeIcon(typeIcon, data.custom_icon)
  const colors = resolveNodeColors(data, activeTheme)
  const statusColor = theme.colors.statusColors[data.status]
  const isOnline = data.status === 'online'

  // Properties: prefer new system; fall back to legacy hardware fields for unmigrated nodes
  const visibleProperties = data.properties?.filter((p) => p.visible) ?? null
  const showLegacyHardware = !data.properties && data.show_hardware &&
    (data.cpu_count != null || data.cpu_model || data.ram_gb != null || data.disk_gb != null)

  return (
    <div
      className="relative flex flex-col rounded-lg border transition-all duration-200 overflow-hidden"
      style={{
        background: colors.background,
        borderColor: colors.border,
        borderWidth,
        boxShadow: isOnline && selected
          ? `0 0 0 ${borderWidth}px ${colors.border}, 0 0 10px ${colors.border}2e, 0 0 3px ${colors.border}1a`
          : isOnline
          ? `0 0 10px ${colors.border}2e, 0 0 3px ${colors.border}1a`
          : selected
          ? `0 0 0 ${borderWidth}px ${colors.border}, 0 0 8px ${colors.border}44`
          : 'none',
        opacity: data.status === 'offline' ? 0.55 : 1,
        // Grow node width when many bottom handles so each stays clickable (~14px slot).
        minWidth: Math.max(140, clampBottomHandles(data.bottom_handles ?? 1) * 14),
        width: width ? '100%' : undefined,
        height: height ? '100%' : undefined,
      }}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={140}
        minHeight={50}
        lineStyle={{ borderColor: 'transparent' }}
        handleStyle={{ borderColor: colors.border, background: colors.border, width: 16, height: 16 }}
      />
      <Handle
        type="source"
        position={Position.Top}
        id="top"
        style={{ background: theme.colors.handleBackground, borderColor: theme.colors.handleBorder }}
      />
      <Handle type="target" position={Position.Top} id="top-t" style={{ opacity: 0, width: 12, height: 12 }} />

      {/* Status dot — absolute to avoid affecting node auto-width */}
      <div
        className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full"
        style={{ backgroundColor: statusColor }}
        title={data.status}
      />

      {/* Main row */}
      <div className="flex flex-row items-center gap-2.5 px-2.5 py-2 min-w-0 overflow-hidden pr-6">
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

        {/* Label + IP */}
        <div className="flex flex-col min-w-0">
          <div
            className="text-xs font-medium leading-tight truncate"
            style={{ color: theme.colors.nodeLabelColor }}
            title={data.label}
          >
            {data.label}
          </div>
          {data.ip && splitIps(data.ip).map((ip) => (
            <div
              key={ip}
              className="font-mono text-[10px] truncate"
              style={{ color: theme.colors.nodeSubtextColor }}
              title={ip}
            >
              {hideIp ? maskIp(ip) : ip}
            </div>
          ))}
        </div>
      </div>

      {/* Properties section (new system) */}
      {visibleProperties && visibleProperties.length > 0 && (
        <>
          <div style={{ height: 1, background: `${colors.border}44`, margin: '0 8px' }} />
          <div className="flex flex-col gap-1 px-2.5 py-1.5 overflow-hidden">
            {visibleProperties.map((prop) => {
              const Icon = resolvePropertyIcon(prop.icon)
              return (
                <div key={prop.key} className="flex items-center gap-1 font-mono text-[10px] min-w-0 overflow-hidden" style={{ color: theme.colors.nodeSubtextColor }}>
                  {Icon && <Icon size={9} className="shrink-0" />}
                  <span className="truncate max-w-15 shrink-0" title={prop.key}>{prop.key}</span>
                  <span className="truncate min-w-0" title={prop.value}>· {prop.value}</span>
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* Legacy hardware section — fallback for nodes not yet migrated */}
      {showLegacyHardware && (
        <>
          <div style={{ height: 1, background: `${colors.border}44`, margin: '0 8px' }} />
          <div className="flex flex-col gap-1 px-2.5 py-1.5">
            {(data.cpu_model || data.cpu_count != null) && (
              <div className="flex items-center gap-1 font-mono text-[10px]" style={{ color: theme.colors.nodeSubtextColor }}>
                <Cpu size={9} className="shrink-0" />
                {data.cpu_model && (
                  <span className="truncate max-w-20" title={data.cpu_model}>{data.cpu_model}</span>
                )}
                {data.cpu_count != null && (
                  <span className="shrink-0">{data.cpu_model ? `· ${data.cpu_count}c` : `${data.cpu_count} cores`}</span>
                )}
              </div>
            )}
            {(data.ram_gb != null || data.disk_gb != null) && (
              <div className="flex items-center gap-2 font-mono text-[10px]" style={{ color: theme.colors.nodeSubtextColor }}>
                {data.ram_gb != null && (
                  <span className="flex items-center gap-0.5">
                    <MemoryStick size={9} className="shrink-0" />
                    {formatStorage(data.ram_gb)}
                  </span>
                )}
                {data.disk_gb != null && (
                  <span className="flex items-center gap-0.5">
                    <HardDrive size={9} className="shrink-0" />
                    {formatStorage(data.disk_gb)}
                  </span>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {bottomHandlePositions(data.bottom_handles ?? 1).map((leftPct, idx) => {
        const sourceId = bottomHandleId(idx)
        const targetId = `${sourceId}-t`
        return (
          <span key={sourceId}>
            <Handle
              type="source"
              position={Position.Bottom}
              id={sourceId}
              style={{ left: `${leftPct}%`, background: theme.colors.handleBackground, borderColor: theme.colors.handleBorder }}
            />
            <Handle
              type="target"
              position={Position.Bottom}
              id={targetId}
              style={{ left: `${leftPct}%`, opacity: 0, width: 12, height: 12 }}
            />
          </span>
        )
      })}
    </div>
  )
}

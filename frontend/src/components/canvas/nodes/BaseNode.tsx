import { createElement, useEffect } from 'react'
import { Handle, Position, NodeResizer, useUpdateNodeInternals, type NodeProps, type Node } from '@xyflow/react'
import { Cpu, MemoryStick, HardDrive, type LucideIcon } from 'lucide-react'
import type { NodeData } from '@/types'
import { resolveNodeColors } from '@/utils/nodeColors'
import { resolveNodeIcon } from '@/utils/nodeIcons'
import { useThemeStore } from '@/stores/themeStore'
import { THEMES } from '@/utils/themes'
import { useCanvasStore } from '@/stores/canvasStore'
import { maskIp } from '@/utils/maskIp'
import { BOTTOM_HANDLE_IDS, BOTTOM_HANDLE_POSITIONS } from '@/utils/handleUtils'

interface BaseNodeProps extends NodeProps<Node<NodeData>> {
  icon: LucideIcon
  topHandleIds?: string[]
  bottomHandleIds?: string[]
  leftHandleIds?: string[]
  rightHandleIds?: string[]
}

const DEFAULT_TOP_HANDLE_IDS = ['top']
const DEFAULT_BOTTOM_HANDLE_IDS = ['bottom']

function formatStorage(gb: number): string {
  if (gb >= 1024) return `${(gb / 1024).toFixed(1).replace(/\.0$/, '')} TB`
  return `${gb} GB`
}

export function BaseNode({
  id,
  data,
  selected,
  icon: typeIcon,
  width,
  height,
  topHandleIds = DEFAULT_TOP_HANDLE_IDS,
  bottomHandleIds = DEFAULT_BOTTOM_HANDLE_IDS,
  leftHandleIds = [],
  rightHandleIds = [],
}: BaseNodeProps) {
  const updateNodeInternals = useUpdateNodeInternals()
  useEffect(() => { updateNodeInternals(id) }, [data.bottom_handles, id, updateNodeInternals])
  const activeTheme = useThemeStore((s) => s.activeTheme)
  const hideIp = useCanvasStore((s) => s.hideIp)
  const theme = THEMES[activeTheme]

  const resolvedIcon = resolveNodeIcon(typeIcon, data.custom_icon)
  const colors = resolveNodeColors(data, activeTheme)
  const statusColor = theme.colors.statusColors[data.status]
  const isOnline = data.status === 'online'
  const showHardware = data.show_hardware && (data.cpu_count != null || data.cpu_model || data.ram_gb != null || data.disk_gb != null)
  const getOffsets = (count: number) => count > 1 ? 100 / (count + 1) : 50

  const renderHandles = (handleIds: string[], side: 'top' | 'bottom' | 'left' | 'right') => {
    const position = side === 'top'
      ? Position.Top
      : side === 'bottom'
      ? Position.Bottom
      : side === 'left'
      ? Position.Left
      : Position.Right
    const offset = getOffsets(handleIds.length)
    return handleIds.flatMap((handleId, index) => {
      const positionPercent = `${offset * (index + 1)}%`
      const coordinateStyle = side === 'top' || side === 'bottom' ? { left: positionPercent } : { top: positionPercent }
      return [
        <Handle
          key={handleId}
          type="source"
          position={position}
          id={handleId}
          style={{ ...coordinateStyle, background: theme.colors.handleBackground, borderColor: theme.colors.handleBorder }}
        />,
        <Handle
          key={`${handleId}-target`}
          type="target"
          position={position}
          id={`${handleId}-t`}
          style={{ ...coordinateStyle, opacity: 0, width: 12, height: 12 }}
        />,
      ]
    })
  }

  return (
    <div
      className="relative flex flex-col rounded-lg border transition-all duration-200"
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
        width: width ? '100%' : undefined,
        height: height ? '100%' : undefined,
      }}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={140}
        minHeight={50}
        lineStyle={{ borderColor: colors.border, borderWidth: 1 }}
        handleStyle={{ borderColor: colors.border, background: colors.border, width: 8, height: 8 }}
      />
      {renderHandles(topHandleIds, 'top')}

      {/* Main row */}
      <div className="flex flex-row items-center gap-2.5 px-2.5 py-2">
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
          {data.ip && (
            <div
              className="font-mono text-[10px] truncate"
              style={{ color: theme.colors.nodeSubtextColor }}
              title={data.ip}
            >
              {hideIp ? maskIp(data.ip) : data.ip}
            </div>
          )}
        </div>
      </div>

      {/* Hardware section */}
      {showHardware && (
        <>
          <div style={{ height: 1, background: `${colors.border}44`, margin: '0 8px' }} />
          <div className="flex flex-col gap-1 px-2.5 py-1.5">
            {/* Line 1: CPU */}
            {(data.cpu_model || data.cpu_count != null) && (
              <div className="flex items-center gap-1 font-mono text-[10px]" style={{ color: theme.colors.nodeSubtextColor }}>
                <Cpu size={9} className="shrink-0" />
                {data.cpu_model && (
                  <span className="truncate max-w-[80px]" title={data.cpu_model}>{data.cpu_model}</span>
                )}
                {data.cpu_count != null && (
                  <span className="shrink-0">{data.cpu_model ? `· ${data.cpu_count}c` : `${data.cpu_count} cores`}</span>
                )}
              </div>
            )}
            {/* Line 2: RAM + Disk */}
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

      {/* Status dot */}
      <div
        className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full shrink-0"
        style={{ backgroundColor: statusColor }}
        title={data.status}
      />

      {renderHandles(leftHandleIds, 'left')}
      {renderHandles(rightHandleIds, 'right')}
      {bottomHandleIds === DEFAULT_BOTTOM_HANDLE_IDS
        ? (BOTTOM_HANDLE_POSITIONS[data.bottom_handles ?? 1] ?? BOTTOM_HANDLE_POSITIONS[1]).map((leftPct, idx) => {
            const sourceId = BOTTOM_HANDLE_IDS[idx]
            const targetId = idx === 0 ? 'bottom-t' : `bottom-${idx + 1}-t`
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
          })
        : renderHandles(bottomHandleIds, 'bottom')}
    </div>
  )
}

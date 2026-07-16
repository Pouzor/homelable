import { createElement, useEffect, useMemo } from 'react'
import { NodeResizer, useUpdateNodeInternals, useViewport, type NodeProps, type Node } from '@xyflow/react'
import { Cpu, MemoryStick, HardDrive, ExternalLink, type LucideIcon } from 'lucide-react'
import type { NodeData } from '@/types'
import { resolveNodeColors } from '@/utils/nodeColors'
import { resolveNodeIcon } from '@/utils/nodeIcons'
import { NodeIcon } from '@/components/ui/NodeIcon'
import { resolvePropertyIcon } from '@/utils/propertyIcons'
import { useThemeStore } from '@/stores/themeStore'
import { THEMES } from '@/utils/themes'
import { useCanvasStore, serviceStatusKey } from '@/stores/canvasStore'
import { maskIp, primaryIp, splitIps } from '@/utils/maskIp'
import { sideHandleCount } from '@/utils/handleUtils'
import { SideHandles } from './SideHandles'
import { getServiceUrl } from '@/utils/serviceUrl'

interface BaseNodeProps extends NodeProps<Node<NodeData>> {
  icon: LucideIcon
}

function formatStorage(gb: number): string {
  if (gb >= 1024) return `${(gb / 1024).toFixed(1).replace(/\.0$/, '')} TB`
  return `${gb} GB`
}

export function BaseNode({ id, data, selected, icon: typeIcon, width, height }: BaseNodeProps) {
  const updateNodeInternals = useUpdateNodeInternals()
  useEffect(() => { updateNodeInternals(id) }, [data.top_handles, data.bottom_handles, data.left_handles, data.right_handles, id, updateNodeInternals])

  const { zoom } = useViewport()
  const borderWidth = useMemo(() => Math.max(1, 1 / zoom), [zoom])

  const activeTheme = useThemeStore((s) => s.activeTheme)
  const hideIp = useCanvasStore((s) => s.hideIp)
  const serviceStatuses = useCanvasStore((s) => s.serviceStatuses)
  const theme = THEMES[activeTheme]

  const resolvedIcon = resolveNodeIcon(typeIcon, data.custom_icon)
  const colors = resolveNodeColors(data, activeTheme)
  const statusColor = theme.colors.statusColors[data.status]
  const isOnline = data.status === 'online'
  const services = data.services ?? []
  const showServices = data.custom_colors?.show_services === true
  const serviceHost = data.ip ? primaryIp(data.ip) : data.hostname

  // Properties: prefer new system; fall back to legacy hardware fields for unmigrated nodes
  const visibleProperties = data.properties?.filter((p) => p.visible) ?? null
  const showLegacyHardware = !data.properties && data.show_hardware &&
    (data.cpu_count != null || data.cpu_model || data.ram_gb != null || data.disk_gb != null)

  // Resolved per-side connection-point counts (missing field → side default).
  const topCount = sideHandleCount(data, 'top')
  const bottomCount = sideHandleCount(data, 'bottom')
  const leftCount = sideHandleCount(data, 'left')
  const rightCount = sideHandleCount(data, 'right')

  return (
    <div
      className="relative flex flex-col rounded-lg border transition-all duration-200"
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
        // Grow node so each handle stays clickable (~14px slot on each axis).
        minWidth: Math.max(140, Math.max(topCount, bottomCount) * 14),
        minHeight: Math.max(50, Math.max(leftCount, rightCount) * 14),
        width: width ? '100%' : undefined,
        height: height ? '100%' : undefined,
      }}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={140}
        minHeight={50}
        lineStyle={{ borderColor: 'transparent' }}
        handleStyle={{ borderColor: colors.border, background: colors.border, width: 8, height: 8, borderRadius: 2 }}
      />
      <SideHandles
        data={data}
        sides={['top', 'left', 'right']}
        handleBackground={theme.colors.handleBackground}
        handleBorder={theme.colors.handleBorder}
        labelColor={theme.colors.nodeSubtextColor}
        showLabels
      />

      {/* Status dot — absolute to avoid affecting node auto-width */}
      <div
        className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full"
        style={{ backgroundColor: statusColor }}
        title={data.status}
      />

      {/* Main row */}
      <div className="flex flex-row items-center gap-2.5 px-2.5 py-2 min-w-0 overflow-hidden">
        {/* Icon */}
        <div
          className="flex items-center justify-center w-7 h-7 rounded-md shrink-0"
          style={{
            color: isOnline ? colors.icon : theme.colors.nodeSubtextColor,
            background: theme.colors.nodeIconBackground,
          }}
        >
          {data.custom_icon
            ? <NodeIcon typeIcon={typeIcon} customIconKey={data.custom_icon} size={15} />
            : createElement(resolvedIcon, { size: 15 })}
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

      {showServices && services.length > 0 && (
        <>
          <div style={{ height: 1, background: `${colors.border}44`, margin: '0 8px' }} />
          <div className="flex flex-col gap-1 px-2.5 py-1.5 overflow-hidden">
            {services.map((svc, idx) => {
              const url = getServiceUrl(svc, serviceHost)
              const svcOffline = serviceStatuses[serviceStatusKey(id, svc.port, svc.protocol)] === 'offline'
              const row = (
                <div
                  className="nodrag flex items-center justify-between gap-2 px-1.5 py-1 rounded text-[10px] min-w-0 overflow-hidden"
                  style={{
                    background: theme.colors.nodeIconBackground,
                    color: theme.colors.nodeSubtextColor,
                  }}
                >
                  
                  <div className="flex items-center justify-between gap-2 w-full min-w-0">
                    {/* LEFT: service name */}
                    <span
                      className="font-medium truncate"
                      style={{ minWidth: 0, color: svcOffline ? '#f85149' : undefined }}
                      title={svc.service_name}
                    >
                      {svc.service_name}
                    </span>

                    {/* RIGHT: path + port */}
                    <div className="flex items-center gap-2 shrink-0 min-w-0">
                      {svc.path && (
                        <span
                          className="truncate text-[#8b949e] text-right max-w-[80px]"
                          title={svc.path}
                        >
                          {svc.path}
                        </span>
                      )}

                      <span className="font-mono opacity-80 flex items-center gap-1">
                        <span>{svc.port}</span>
                        <ExternalLink
                          size={9}
                          className={`shrink-0 ${url ? '' : 'opacity-0'}`}
                        />
                      </span>
                    </div>
                  </div>
                </div>
              )

              if (!url) return <div key={`${svc.port}-${svc.protocol}-${svc.service_name}-${idx}`}>{row}</div>

              return (
                <a
                  key={`${svc.port}-${svc.protocol}-${svc.service_name}-${idx}`}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block hover:opacity-85 transition-opacity"
                  title={url}
                  onClick={(e) => e.stopPropagation()}
                >
                  {row}
                </a>
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

      <SideHandles
        data={data}
        sides={['bottom']}
        handleBackground={theme.colors.handleBackground}
        handleBorder={theme.colors.handleBorder}
        labelColor={theme.colors.nodeSubtextColor}
        showLabels
      />
    </div>
  )
}

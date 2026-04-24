import { createElement } from 'react'
import { Handle, Position, NodeResizer, type NodeProps, type Node } from '@xyflow/react'
import { Layers } from 'lucide-react'
import type { NodeData } from '@/types'
import { resolveNodeColors } from '@/utils/nodeColors'
import { resolveNodeIcon } from '@/utils/nodeIcons'
import { resolvePropertyIcon } from '@/utils/propertyIcons'
import { useCanvasStore } from '@/stores/canvasStore'
import { maskIp, splitIps } from '@/utils/maskIp'
import { useThemeStore } from '@/stores/themeStore'
import { THEMES } from '@/utils/themes'

export function ContainerGroupNode(props: NodeProps<Node<NodeData>>) {
  const { data, selected } = props

  const activeTheme = useThemeStore((s) => s.activeTheme)
  const hideIp = useCanvasStore((s) => s.hideIp)

  const theme = THEMES[activeTheme]
  const colors = resolveNodeColors(data, activeTheme)

  const statusColor = theme.colors.statusColors[data.status]
  const isOnline = data.status === 'online'
  const glow = colors.border
  const containerAccent = colors.border

  const resolvedIcon = resolveNodeIcon(Layers, data.custom_icon)

  const visibleProps = data.properties?.filter((p) => p.visible) ?? []

  return (
    <>
      <div
        className="relative w-full h-full rounded-lg border-2 flex flex-col overflow-hidden"
        style={{
          borderColor: selected ? glow : `${glow}88`,
          background: isOnline
            ? `${colors.background}cc`
            : `${colors.background}aa`,
          boxShadow: isOnline
            ? `0 0 20px ${glow}1a, inset 0 0 40px ${glow}08`
            : selected
            ? `0 0 12px ${glow}33`
            : 'none',
        }}
      >
        {/* Resize */}
        <NodeResizer
          isVisible={selected}
          minWidth={140}
          minHeight={50}
          lineStyle={{ borderColor: 'transparent' }}
          handleStyle={{
            borderColor: colors.border,
            background: colors.border,
            width: 16,
            height: 16,
            zIndex: 50,
          }}
        />

        {/* HEADER */}
        <div
          className="flex items-start gap-2 px-2.5 py-1.5 shrink-0"
          style={{
            background: isOnline ? `${glow}33` : `${glow}08`,
            borderBottom: `1px solid ${
              isOnline ? `${glow}33` : `${glow}22`
            }`,
          }}
        >
          <div
            className="flex items-center justify-center w-5 h-5 rounded-md shrink-0"
            style={{
              color: isOnline
                ? colors.icon
                : theme.colors.nodeSubtextColor,
              background: theme.colors.nodeIconBackground,
            }}
          >
            {createElement(resolvedIcon, { size: 12 })}
          </div>

          <div className="flex flex-col min-w-0 flex-1">
            <span
              className="text-[11px] font-semibold leading-tight truncate"
              style={{
                color: isOnline ? glow : theme.colors.nodeLabelColor,
              }}
            >
              {data.label}
            </span>

            {data.ip &&
              splitIps(data.ip).map((ip) => (
                <span
                  key={ip}
                  className="font-mono text-[9px] truncate"
                  style={{ color: theme.colors.nodeSubtextColor }}
                >
                  {hideIp ? maskIp(ip) : ip}
                </span>
              ))}
          </div>

          <div
            className="ml-auto w-1.5 h-1.5 rounded-full shrink-0"
            style={{ backgroundColor: statusColor }}
            title={data.status}
          />
        </div>

        {/* PROPERTIES */}
        {visibleProps.length > 0 && (
          <div className="shrink-0">
            {visibleProps.map((prop, i) => {
              const Icon = resolvePropertyIcon(prop.icon)

              return (
                <div
                  key={prop.key}
                  className="flex items-center gap-1 font-mono text-[10px] min-w-0 overflow-hidden px-2.5"
                  style={{
                    color: theme.colors.nodeSubtextColor,
                    paddingTop: i === 0 ? 4 : 2,
                    paddingBottom:
                      i === visibleProps.length - 1 ? 4 : 2,
                    borderTop:
                      i === 0
                        ? `1px solid ${glow}22`
                        : undefined,
                  }}
                >
                  {Icon && <Icon size={9} className="shrink-0" />}

                  <span
                    className="truncate max-w-20 shrink-0"
                    title={prop.key}
                  >
                    {prop.key}
                  </span>

                  <span
                    className="truncate min-w-0"
                    title={prop.value}
                  >
                    · {prop.value}
                  </span>
                </div>
              )
            })}
          </div>
        )}

        {/* CHILD CONTAINER */}
        <div className="flex-1 min-h-0 relative overflow-hidden pointer-events-none" />
      </div>

      {/* HANDLES */}

      <Handle
        type="source"
        position={Position.Top}
        id="top"
        style={{
          background: theme.colors.handleBackground,
          borderColor: theme.colors.handleBorder,
        }}
      />
      <Handle
        type="target"
        position={Position.Top}
        id="top-t"
        style={{ opacity: 0, width: 12, height: 12 }}
      />

      <Handle
        type="source"
        position={Position.Bottom}
        id="bottom"
        style={{
          background: theme.colors.handleBackground,
          borderColor: theme.colors.handleBorder,
        }}
      />
      <Handle
        type="target"
        position={Position.Bottom}
        id="bottom-t"
        style={{ opacity: 0, width: 12, height: 12 }}
      />

      {/* Cluster handles */}
      <Handle
        type="source"
        position={Position.Left}
        id="cluster-left"
        title="Same cluster"
        style={{
          background: containerAccent,
          borderColor: `${containerAccent}88`,
          width: 6,
          height: 6,
        }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="cluster-right"
        title="Same cluster"
        style={{
          background: containerAccent,
          borderColor: `${containerAccent}88`,
          width: 6,
          height: 6,
        }}
      />
    </>
  )
}

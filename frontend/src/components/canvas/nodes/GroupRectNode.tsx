import { useState } from 'react'
import { Handle, Position, NodeResizer, type NodeProps, type Node } from '@xyflow/react'
import { ChevronDown } from 'lucide-react'
import { useCanvasStore } from '@/stores/canvasStore'
import { getZoneSpatialChildren } from '@/utils/collapseFilter'
import type { NodeData, TextPosition } from '@/types'

const FONT_FAMILIES: Record<string, string> = {
  inter: 'Inter, sans-serif',
  mono: '"JetBrains Mono", monospace',
  serif: 'Georgia, serif',
}

interface AlignStyle {
  alignItems: string
  justifyContent: string
  textAlign: React.CSSProperties['textAlign']
}

const POSITION_STYLES: Record<TextPosition, AlignStyle> = {
  'top-left':      { alignItems: 'flex-start', justifyContent: 'flex-start', textAlign: 'left' },
  'top-center':    { alignItems: 'flex-start', justifyContent: 'center',     textAlign: 'center' },
  'top-right':     { alignItems: 'flex-start', justifyContent: 'flex-end',   textAlign: 'right' },
  'middle-left':   { alignItems: 'center',     justifyContent: 'flex-start', textAlign: 'left' },
  'center':        { alignItems: 'center',     justifyContent: 'center',     textAlign: 'center' },
  'middle-right':  { alignItems: 'center',     justifyContent: 'flex-end',   textAlign: 'right' },
  'bottom-left':   { alignItems: 'flex-end',   justifyContent: 'flex-start', textAlign: 'left' },
  'bottom-center': { alignItems: 'flex-end',   justifyContent: 'center',     textAlign: 'center' },
  'bottom-right':  { alignItems: 'flex-end',   justifyContent: 'flex-end',   textAlign: 'right' },
}

const HANDLE_SIDES = [
  { id: 'zone-top',    position: Position.Top },
  { id: 'zone-right',  position: Position.Right },
  { id: 'zone-bottom', position: Position.Bottom },
  { id: 'zone-left',   position: Position.Left },
] as const

export function GroupRectNode({ id, data, selected }: NodeProps<Node<NodeData>>) {
  const setEditingGroupRectId = useCanvasStore((s) => s.setEditingGroupRectId)
  const toggleNodeCollapsed = useCanvasStore((s) => s.toggleNodeCollapsed)
  const nodes = useCanvasStore((s) => s.nodes)
  const [hovered, setHovered] = useState(false)

  const rc = data.custom_colors ?? {}
  const isCollapsed = data.collapsed ?? false
  const borderColor = rc.border ?? '#00d4ff'
  const borderStyle = rc.border_style ?? 'solid'
  const borderWidth = rc.border_width ?? 2
  const backgroundColor = rc.background ?? 'rgba(0,212,255,0.05)'
  const textColor = rc.text_color ?? '#e6edf3'
  const textSize: number = rc.text_size ?? 12
  const labelPosition: string = rc.label_position ?? 'inside'
  const fontFamily = FONT_FAMILIES[rc.font ?? 'inter'] ?? FONT_FAMILIES.inter
  const textPos = (rc.text_position ?? 'top-left') as TextPosition
  const posStyle = POSITION_STYLES[textPos]

  // Count children for collapse badge — groupRect zones don't parent their
  // contents via React Flow parentId, so we hit-test by spatial containment.
  const selfNode = (nodes ?? []).find((n) => n.id === id)
  const childrenCount = selfNode
    ? getZoneSpatialChildren(selfNode, nodes ?? []).length
    : 0

  const outsideJustify = textPos.includes('right') ? 'flex-end'
    : (textPos.includes('center') || textPos === 'center') ? 'center'
    : 'flex-start'

  const isOutsideBottom = textPos.startsWith('bottom')
  const outsideOffset = textSize + 16
  const outsideVertical: React.CSSProperties = isOutsideBottom
    ? { bottom: -outsideOffset }
    : { top: -outsideOffset }

  const sharedTextStyle: React.CSSProperties = {
    color: textColor,
    fontFamily,
    fontSize: textSize,
    fontWeight: 500,
    userSelect: 'none',
    whiteSpace: 'pre-wrap',
  }

  const handleStyle: React.CSSProperties = {
    width: 10,
    height: 10,
    background: borderColor,
    border: '2px solid #0d1117',
    borderRadius: '50%',
    opacity: hovered ? 1 : 0,
    transition: 'opacity 0.15s',
  }

  return (
    <>
      <NodeResizer
        isVisible={selected}
        minWidth={80}
        minHeight={60}
        handleStyle={{
          width: 8,
          height: 8,
          borderRadius: 2,
          background: '#00d4ff',
          border: '1px solid #0d1117',
        }}
        lineStyle={{ borderColor: 'transparent' }}
      />

      {HANDLE_SIDES.map(({ id: hid, position }) => (
        <span key={hid}>
          <Handle type="source" id={hid} position={position} style={handleStyle} />
          <Handle type="target" id={`${hid}-t`} position={position} style={{ ...handleStyle, opacity: 0, width: 14, height: 14 }} />
        </span>
      ))}

      <div
        style={{
          position: 'relative',
          overflow: 'visible',
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: posStyle.alignItems,
          justifyContent: posStyle.justifyContent,
          padding: 12,
          background: backgroundColor,
          border: `${borderWidth}px ${borderStyle} ${borderColor}`,
          boxShadow: selected ? '0 0 0 1px #00d4ff, 0 0 8px #00d4ff44' : 'none',
          borderRadius: 10,
          boxSizing: 'border-box',
          cursor: 'default',
          transition: 'opacity 0.2s ease-out, filter 0.2s ease-out',
          opacity: isCollapsed ? 0.6 : 1,
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onDoubleClick={(e) => {
          e.stopPropagation()
          setEditingGroupRectId(id)
        }}
      >
        {childrenCount > 0 && (
          <button
            className="nodrag"
            onClick={(e) => {
              e.stopPropagation()
              toggleNodeCollapsed(id)
            }}
            style={{
              position: 'absolute',
              top: 6,
              right: 6,
              width: 20,
              height: 20,
              padding: 0,
              background: 'rgba(0, 212, 255, 0.1)',
              border: '1px solid rgba(0, 212, 255, 0.3)',
              borderRadius: 4,
              color: borderColor,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.2s ease-out, transform 0.2s ease-out',
              transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
            }}
            title={isCollapsed ? `Show ${childrenCount} hidden items` : `Hide ${childrenCount} items`}
          >
            <ChevronDown size={14} />
          </button>
        )}
        {isCollapsed && childrenCount > 0 && (
          <span
            style={{
              position: 'absolute',
              bottom: 6,
              right: 6,
              fontSize: 10,
              color: borderColor,
              opacity: 0.7,
              userSelect: 'none',
            }}
          >
            +{childrenCount}
          </span>
        )}
        {labelPosition === 'outside' && data.label && (
          <span
            style={{
              position: 'absolute',
              ...outsideVertical,
              left: 0,
              right: 0,
              display: 'flex',
              justifyContent: outsideJustify,
              pointerEvents: 'none',
              ...sharedTextStyle,
            }}
          >
            {data.label}
          </span>
        )}
        {labelPosition === 'inside' && data.label && (
          <span style={{ textAlign: posStyle.textAlign, ...sharedTextStyle }}>
            {data.label}
          </span>
        )}
      </div>
    </>
  )
}

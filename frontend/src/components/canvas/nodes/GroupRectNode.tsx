import { NodeResizer, type NodeProps, type Node } from '@xyflow/react'
import { useCanvasStore } from '@/stores/canvasStore'
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

export function GroupRectNode({ id, data, selected }: NodeProps<Node<NodeData>>) {
  const setEditingGroupRectId = useCanvasStore((s) => s.setEditingGroupRectId)

  const rc = data.custom_colors ?? {}
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
        lineStyle={{ borderColor: '#00d4ff55', borderWidth: 1 }}
      />
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
          border: `${selected ? borderWidth + 1 : borderWidth}px ${selected ? 'solid' : borderStyle} ${selected ? '#00d4ff' : borderColor}`,
          borderRadius: 10,
          boxSizing: 'border-box',
          cursor: 'default',
        }}
        onDoubleClick={(e) => {
          e.stopPropagation()
          setEditingGroupRectId(id)
        }}
      >
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

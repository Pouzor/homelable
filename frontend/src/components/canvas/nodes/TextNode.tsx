import { NodeResizer, type NodeProps, type Node } from '@xyflow/react'
import { useCanvasStore } from '@/stores/canvasStore'
import type { NodeData } from '@/types'

const FONT_FAMILIES: Record<string, string> = {
  inter: 'Inter, sans-serif',
  mono: '"JetBrains Mono", monospace',
  serif: 'Georgia, serif',
  sans: 'system-ui, sans-serif',
}

export function TextNode({ id, data, selected }: NodeProps<Node<NodeData>>) {
  const setEditingTextId = useCanvasStore((s) => s.setEditingTextId)

  const rc = data.custom_colors ?? {}
  const borderColor = rc.border ?? '#30363d'
  const borderStyle = rc.border_style ?? 'none'
  const borderWidth = rc.border_width ?? 1
  const backgroundColor = rc.background ?? 'transparent'
  const textColor = rc.text_color ?? '#e6edf3'
  const textSize: number = rc.text_size ?? 14
  const fontFamily = FONT_FAMILIES[rc.font ?? 'inter'] ?? FONT_FAMILIES.inter

  const content = data.text_content ?? data.label ?? ''

  return (
    <>
      <NodeResizer
        isVisible={selected}
        minWidth={40}
        minHeight={20}
        handleStyle={{
          width: 8,
          height: 8,
          borderRadius: 2,
          background: '#00d4ff',
          border: '1px solid #0d1117',
        }}
        lineStyle={{ borderColor: 'transparent' }}
      />

      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 8,
          background: backgroundColor,
          border: borderStyle === 'none' ? 'none' : `${borderWidth}px ${borderStyle} ${borderColor}`,
          boxShadow: selected ? '0 0 0 1px #00d4ff, 0 0 8px #00d4ff44' : 'none',
          borderRadius: 6,
          boxSizing: 'border-box',
          cursor: 'default',
          color: textColor,
          fontFamily,
          fontSize: textSize,
          fontWeight: 500,
          userSelect: 'none',
          whiteSpace: 'pre-wrap',
          textAlign: 'center',
        }}
        onDoubleClick={(e) => {
          e.stopPropagation()
          setEditingTextId(id)
        }}
      >
        {content}
      </div>
    </>
  )
}

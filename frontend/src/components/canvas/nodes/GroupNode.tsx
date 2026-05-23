import { useState } from 'react'
import { type NodeProps, type Node, NodeResizer, Handle, Position } from '@xyflow/react'
import { Layers, Pencil, Check, X } from 'lucide-react'
import { useCanvasStore } from '@/stores/canvasStore'
import { useThemeStore } from '@/stores/themeStore'
import { THEMES } from '@/utils/themes'
import { STATUS_COLORS, type NodeData } from '@/types'

export function GroupNode({ id, data, selected }: NodeProps<Node<NodeData>>) {
  const { nodes, updateNode, snapshotHistory } = useCanvasStore()
  const activeTheme = useThemeStore((s) => s.activeTheme)
  const theme = THEMES[activeTheme]
  const showBorder = data.custom_colors?.show_border !== false
  const isVisible = showBorder || selected

  const [editing, setEditing] = useState(false)
  const [labelDraft, setLabelDraft] = useState(data.label)

  const children = nodes.filter((n) => n.parentId === id)
  const onlineCount = children.filter((n) => n.data.status === 'online').length
  const offlineCount = children.filter((n) => n.data.status === 'offline').length
  const unknownCount = children.length - onlineCount - offlineCount

  const handleRename = () => {
    if (labelDraft.trim()) {
      snapshotHistory()
      updateNode(id, { label: labelDraft.trim() })
    }
    setEditing(false)
  }

  const borderColor = selected ? '#00d4ff' : '#30363d'
  const borderStyle = selected ? 'solid' : 'dashed'

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        borderRadius: 8,
        border: isVisible ? `2px ${borderStyle} ${borderColor}` : '2px solid transparent',
        background: 'transparent',
        transition: 'border-color 0.15s, background 0.15s',
        boxSizing: 'border-box',
      }}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={120}
        minHeight={80}
        lineStyle={{ stroke: '#00d4ff', strokeWidth: 1 }}
        handleStyle={{ fill: '#00d4ff', stroke: '#0d1117', width: 8, height: 8, borderRadius: 2 }}
      />

      {/* 4 snap-point handles — one per side. Source + invisible target overlay for each. */}
      {([
        ['group-top', Position.Top],
        ['group-right', Position.Right],
        ['group-bottom', Position.Bottom],
        ['group-left', Position.Left],
      ] as const).map(([hid, pos]) => (
        <span key={hid}>
          <Handle
            type="source"
            position={pos}
            id={hid}
            style={{ background: theme.colors.handleBackground, borderColor: theme.colors.handleBorder }}
          />
          <Handle
            type="target"
            position={pos}
            id={`${hid}-t`}
            style={{ opacity: 0, width: 12, height: 12 }}
          />
        </span>
      ))}

      {/* Header */}
      {isVisible && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            padding: '5px 10px',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: selected ? 'rgba(0,212,255,0.08)' : 'rgba(22,27,34,0.8)',
            borderRadius: '6px 6px 0 0',
            borderBottom: isVisible ? `1px solid ${borderColor}40` : 'none',
            pointerEvents: 'auto',
          }}
        >
          <Layers size={12} style={{ color: '#00d4ff', flexShrink: 0 }} />

          {editing ? (
            <input
              autoFocus
              className="nodrag"
              value={labelDraft}
              onChange={(e) => setLabelDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRename()
                if (e.key === 'Escape') { setLabelDraft(data.label); setEditing(false) }
              }}
              style={{
                flex: 1,
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: '#e6edf3',
                fontSize: 11,
                fontWeight: 600,
              }}
            />
          ) : (
            <span style={{ flex: 1, fontSize: 11, fontWeight: 600, color: '#e6edf3', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {data.label}
            </span>
          )}

          {editing ? (
            <>
              <button className="nodrag" onClick={handleRename} style={{ color: '#39d353', background: 'none', border: 'none', cursor: 'pointer', padding: 1 }}><Check size={11} /></button>
              <button className="nodrag" onClick={() => { setLabelDraft(data.label); setEditing(false) }} style={{ color: '#f85149', background: 'none', border: 'none', cursor: 'pointer', padding: 1 }}><X size={11} /></button>
            </>
          ) : (
            <button
              className="nodrag"
              onClick={() => { setLabelDraft(data.label); setEditing(true) }}
              style={{ color: '#8b949e', background: 'none', border: 'none', cursor: 'pointer', padding: 1, opacity: selected ? 1 : 0 }}
              title="Rename group"
            >
              <Pencil size={10} />
            </button>
          )}

          {/* Status summary */}
          {children.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, flexShrink: 0, marginLeft: 4 }}>
              {onlineCount > 0 && <span style={{ color: STATUS_COLORS.online }}>● {onlineCount}</span>}
              {offlineCount > 0 && <span style={{ color: STATUS_COLORS.offline }}>● {offlineCount}</span>}
              {unknownCount > 0 && <span style={{ color: STATUS_COLORS.unknown }}>● {unknownCount}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

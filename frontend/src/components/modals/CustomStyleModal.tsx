import { useState, useCallback } from 'react'
import { toast } from 'sonner'
import {
  Globe, Router, Network, Server, Layers, Box, Container, HardDrive,
  Cpu, Wifi, Camera, Printer, Monitor, PlugZap, Anchor, Package, Circle,
  type LucideIcon,
} from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useThemeStore } from '@/stores/themeStore'
import { useCanvasStore } from '@/stores/canvasStore'
import { THEMES } from '@/utils/themes'
import { applyOpacity } from '@/utils/colorUtils'
import type {
  NodeType, EdgeType, NodeTypeStyle, EdgeTypeStyle, CustomStyleDef, EdgePathStyle,
} from '@/types'
import { NODE_TYPE_LABELS, EDGE_TYPE_LABELS } from '@/types'

// ── Node types exposed for custom style (skip groupRect/group) ───────────────

const EDITABLE_NODE_TYPES: NodeType[] = [
  'isp', 'router', 'switch', 'server', 'proxmox', 'vm', 'lxc', 'nas',
  'iot', 'ap', 'camera', 'printer', 'computer', 'cpl', 'docker_host',
  'docker_container', 'generic',
]

const EDITABLE_EDGE_TYPES: EdgeType[] = ['ethernet', 'wifi', 'iot', 'vlan', 'virtual', 'cluster']

const NODE_ICONS: Record<string, LucideIcon> = {
  isp: Globe, router: Router, switch: Network, server: Server, proxmox: Layers,
  vm: Box, lxc: Container, nas: HardDrive, iot: Cpu, ap: Wifi,
  camera: Camera, printer: Printer, computer: Monitor, cpl: PlugZap,
  docker_host: Anchor, docker_container: Package, generic: Circle,
}

// ── Default style for a node type (from default theme) ─────────────────────

function defaultNodeStyle(nodeType: NodeType): NodeTypeStyle {
  const accent = THEMES.default.colors.nodeAccents[nodeType] ?? THEMES.default.colors.nodeAccents.generic
  return {
    borderColor: accent.border,
    borderOpacity: 1,
    bgColor: THEMES.default.colors.nodeCardBackground,
    bgOpacity: 1,
    iconColor: accent.icon,
    iconOpacity: 1,
    width: 0,
    height: 0,
  }
}

function defaultEdgeStyle(edgeType: EdgeType): EdgeTypeStyle {
  return {
    color: THEMES.default.colors.edgeColors[edgeType],
    opacity: 1,
    pathStyle: 'bezier',
    animated: 'none',
  }
}

// ── Color + opacity row ──────────────────────────────────────────────────────

interface ColorRowProps {
  label: string
  color: string
  opacity: number
  onColorChange: (v: string) => void
  onOpacityChange: (v: number) => void
}

function ColorRow({ label, color, opacity, onColorChange, onOpacityChange }: ColorRowProps) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-[#8b949e] w-20 shrink-0">{label}</span>
      <input
        type="color"
        value={color}
        onChange={(e) => onColorChange(e.target.value)}
        className="w-7 h-7 rounded cursor-pointer border border-[#30363d] bg-transparent p-0.5"
      />
      <div className="flex items-center gap-2 flex-1">
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={opacity}
          onChange={(e) => onOpacityChange(parseFloat(e.target.value))}
          className="flex-1 h-1 accent-[#00d4ff]"
        />
        <span className="text-xs text-[#8b949e] w-8 text-right">
          {Math.round(opacity * 100)}%
        </span>
      </div>
      <div
        className="w-5 h-5 rounded border border-[#30363d] shrink-0"
        style={{ background: applyOpacity(color, opacity) }}
      />
    </div>
  )
}

// ── Node type editor ─────────────────────────────────────────────────────────

interface NodeEditorProps {
  nodeType: NodeType
  style: NodeTypeStyle
  onChange: (s: NodeTypeStyle) => void
  onApplyToExisting: () => void
}

function NodeEditor({ nodeType, style, onChange, onApplyToExisting }: NodeEditorProps) {
  const set = useCallback(<K extends keyof NodeTypeStyle>(k: K, v: NodeTypeStyle[K]) => {
    onChange({ ...style, [k]: v })
  }, [style, onChange])

  return (
    <div className="flex flex-col gap-4">
      <div className="text-sm font-semibold text-[#e6edf3]">{NODE_TYPE_LABELS[nodeType]}</div>
      <div className="flex flex-col gap-3">
        <ColorRow
          label="Border"
          color={style.borderColor}
          opacity={style.borderOpacity}
          onColorChange={(v) => set('borderColor', v)}
          onOpacityChange={(v) => set('borderOpacity', v)}
        />
        <ColorRow
          label="Background"
          color={style.bgColor}
          opacity={style.bgOpacity}
          onColorChange={(v) => set('bgColor', v)}
          onOpacityChange={(v) => set('bgOpacity', v)}
        />
        <ColorRow
          label="Icon"
          color={style.iconColor}
          opacity={style.iconOpacity}
          onColorChange={(v) => set('iconColor', v)}
          onOpacityChange={(v) => set('iconOpacity', v)}
        />
      </div>

      <div className="border-t border-[#30363d] pt-3">
        <div className="text-xs text-[#8b949e] mb-2">Default size (0 = auto)</div>
        <div className="flex gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-[#8b949e]">W</span>
            <input
              type="number"
              min={0}
              step={10}
              value={style.width}
              onChange={(e) => set('width', parseInt(e.target.value) || 0)}
              className="w-20 h-7 text-xs bg-[#0d1117] border border-[#30363d] rounded px-2 text-[#e6edf3]"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-[#8b949e]">H</span>
            <input
              type="number"
              min={0}
              step={10}
              value={style.height}
              onChange={(e) => set('height', parseInt(e.target.value) || 0)}
              className="w-20 h-7 text-xs bg-[#0d1117] border border-[#30363d] rounded px-2 text-[#e6edf3]"
            />
          </div>
        </div>
      </div>

      <Button
        size="sm"
        variant="outline"
        className="self-start border-[#30363d] text-[#e6edf3] hover:bg-[#21262d]"
        onClick={onApplyToExisting}
      >
        Apply to existing {NODE_TYPE_LABELS[nodeType]} nodes
      </Button>
    </div>
  )
}

// ── Edge type editor ─────────────────────────────────────────────────────────

interface EdgeEditorProps {
  edgeType: EdgeType
  style: EdgeTypeStyle
  onChange: (s: EdgeTypeStyle) => void
  onApplyToExisting: () => void
}

function EdgeEditor({ edgeType, style, onChange, onApplyToExisting }: EdgeEditorProps) {
  const set = useCallback(<K extends keyof EdgeTypeStyle>(k: K, v: EdgeTypeStyle[K]) => {
    onChange({ ...style, [k]: v })
  }, [style, onChange])

  return (
    <div className="flex flex-col gap-4">
      <div className="text-sm font-semibold text-[#e6edf3]">{EDGE_TYPE_LABELS[edgeType]}</div>
      <div className="flex flex-col gap-3">
        <ColorRow
          label="Color"
          color={style.color}
          opacity={style.opacity}
          onColorChange={(v) => set('color', v)}
          onOpacityChange={(v) => set('opacity', v)}
        />
      </div>

      <div className="border-t border-[#30363d] pt-3 flex flex-col gap-3">
        <div>
          <div className="text-xs text-[#8b949e] mb-2">Path style</div>
          <div className="flex gap-2">
            {(['bezier', 'smooth'] as EdgePathStyle[]).map((ps) => (
              <button
                key={ps}
                type="button"
                onClick={() => set('pathStyle', ps)}
                className="px-3 py-1 text-xs rounded border transition-colors"
                style={{
                  borderColor: style.pathStyle === ps ? '#00d4ff' : '#30363d',
                  background: style.pathStyle === ps ? '#00d4ff22' : 'transparent',
                  color: style.pathStyle === ps ? '#00d4ff' : '#8b949e',
                }}
              >
                {ps.charAt(0).toUpperCase() + ps.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="text-xs text-[#8b949e] mb-2">Animation</div>
          <select
            value={style.animated}
            onChange={(e) => set('animated', e.target.value as EdgeTypeStyle['animated'])}
            className="w-full h-7 text-xs bg-[#0d1117] border border-[#30363d] rounded px-2 text-[#e6edf3]"
          >
            <option value="none">None</option>
            <option value="basic">Basic</option>
            <option value="flow">Flow</option>
            <option value="snake">Snake</option>
          </select>
        </div>
      </div>

      <Button
        size="sm"
        variant="outline"
        className="self-start border-[#30363d] text-[#e6edf3] hover:bg-[#21262d]"
        onClick={onApplyToExisting}
      >
        Apply to existing {EDGE_TYPE_LABELS[edgeType]} edges
      </Button>
    </div>
  )
}

// ── Main modal ───────────────────────────────────────────────────────────────

type Tab = 'nodes' | 'edges'
type Selection = { kind: 'node'; type: NodeType } | { kind: 'edge'; type: EdgeType } | null

interface CustomStyleModalProps {
  open: boolean
  onClose: () => void
}

export function CustomStyleModal({ open, onClose }: CustomStyleModalProps) {
  const { customStyle, setCustomStyle } = useThemeStore()
  const { markUnsaved, applyTypeNodeStyle, applyTypeEdgeStyle, applyAllCustomStyles } = useCanvasStore()

  const [tab, setTab] = useState<Tab>('nodes')
  const [selection, setSelection] = useState<Selection>(null)
  const [draft, setDraft] = useState<CustomStyleDef>(() => ({
    nodes: { ...customStyle.nodes },
    edges: { ...customStyle.edges },
  }))

  const handleOpen = (isOpen: boolean) => {
    if (isOpen) {
      // Reset draft to current saved customStyle on open
      setDraft({ nodes: { ...customStyle.nodes }, edges: { ...customStyle.edges } })
      setSelection(null)
    } else {
      onClose()
    }
  }

  const getNodeStyle = (t: NodeType): NodeTypeStyle =>
    draft.nodes[t] ?? defaultNodeStyle(t)

  const getEdgeStyle = (t: EdgeType): EdgeTypeStyle =>
    draft.edges[t] ?? defaultEdgeStyle(t)

  const handleNodeChange = (t: NodeType, s: NodeTypeStyle) =>
    setDraft((d) => ({ ...d, nodes: { ...d.nodes, [t]: s } }))

  const handleEdgeChange = (t: EdgeType, s: EdgeTypeStyle) =>
    setDraft((d) => ({ ...d, edges: { ...d.edges, [t]: s } }))

  const handleApplyNodeType = (t: NodeType) => {
    const style = getNodeStyle(t)
    applyTypeNodeStyle(t, style)
    toast.success(`Applied style to all ${NODE_TYPE_LABELS[t]} nodes`)
  }

  const handleApplyEdgeType = (t: EdgeType) => {
    const style = getEdgeStyle(t)
    applyTypeEdgeStyle(t, style)
    toast.success(`Applied style to all ${EDGE_TYPE_LABELS[t]} edges`)
  }

  const handleSave = () => {
    setCustomStyle(draft)
    markUnsaved()
    toast.success('Custom style saved — save your canvas to persist')
    onClose()
  }

  const handleApplyAll = () => {
    setCustomStyle(draft)
    applyAllCustomStyles(draft)
    markUnsaved()
    toast.success('Custom style applied to all nodes and edges')
    onClose()
  }

  const selectedNodeStyle = selection?.kind === 'node' ? getNodeStyle(selection.type) : null
  const selectedEdgeStyle = selection?.kind === 'edge' ? getEdgeStyle(selection.type) : null

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogContent className="bg-[#161b22] border-[#30363d] max-w-[calc(100%-2rem)] sm:max-w-3xl max-h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-[#30363d]">
          <DialogTitle className="text-sm font-semibold">Custom Style Editor</DialogTitle>
        </DialogHeader>

        <div className="flex flex-1 overflow-hidden min-h-0">
          {/* Left panel — type list */}
          <div className="w-52 shrink-0 border-r border-[#30363d] flex flex-col overflow-hidden">
            {/* Tabs */}
            <div className="flex border-b border-[#30363d]">
              {(['nodes', 'edges'] as Tab[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => { setTab(t); setSelection(null) }}
                  className="flex-1 py-2 text-xs font-medium transition-colors"
                  style={{
                    borderBottom: tab === t ? '2px solid #00d4ff' : '2px solid transparent',
                    color: tab === t ? '#00d4ff' : '#8b949e',
                  }}
                >
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>

            {/* Type list */}
            <div className="flex-1 overflow-y-auto py-1">
              {tab === 'nodes' && EDITABLE_NODE_TYPES.map((t) => {
                const Icon = NODE_ICONS[t] ?? Circle
                const style = draft.nodes[t]
                const isSelected = selection?.kind === 'node' && selection.type === t
                const swatchColor = style
                  ? applyOpacity(style.borderColor, style.borderOpacity)
                  : THEMES.default.colors.nodeAccents[t]?.border ?? '#8b949e'

                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setSelection({ kind: 'node', type: t })}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors text-left"
                    style={{
                      background: isSelected ? '#21262d' : 'transparent',
                      color: isSelected ? '#e6edf3' : '#8b949e',
                    }}
                  >
                    <Icon size={13} />
                    <span className="flex-1 truncate">{NODE_TYPE_LABELS[t]}</span>
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ background: swatchColor }}
                    />
                  </button>
                )
              })}

              {tab === 'edges' && EDITABLE_EDGE_TYPES.map((t) => {
                const style = draft.edges[t]
                const isSelected = selection?.kind === 'edge' && selection.type === t
                const swatchColor = style
                  ? applyOpacity(style.color, style.opacity)
                  : THEMES.default.colors.edgeColors[t]

                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setSelection({ kind: 'edge', type: t })}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors text-left"
                    style={{
                      background: isSelected ? '#21262d' : 'transparent',
                      color: isSelected ? '#e6edf3' : '#8b949e',
                    }}
                  >
                    <span className="flex-1 truncate">{EDGE_TYPE_LABELS[t]}</span>
                    <span
                      className="w-8 h-1.5 rounded-full shrink-0"
                      style={{ background: swatchColor }}
                    />
                  </button>
                )
              })}
            </div>
          </div>

          {/* Right panel — editor */}
          <div className="flex-1 overflow-y-auto p-5">
            {!selection && (
              <div className="flex items-center justify-center h-full text-xs text-[#8b949e]">
                Select a {tab === 'nodes' ? 'node type' : 'edge type'} from the list to edit its style
              </div>
            )}

            {selection?.kind === 'node' && selectedNodeStyle && (
              <NodeEditor
                key={selection.type}
                nodeType={selection.type}
                style={selectedNodeStyle}
                onChange={(s) => handleNodeChange(selection.type, s)}
                onApplyToExisting={() => handleApplyNodeType(selection.type)}
              />
            )}

            {selection?.kind === 'edge' && selectedEdgeStyle && (
              <EdgeEditor
                key={selection.type}
                edgeType={selection.type}
                style={selectedEdgeStyle}
                onChange={(s) => handleEdgeChange(selection.type, s)}
                onApplyToExisting={() => handleApplyEdgeType(selection.type)}
              />
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-between gap-2 px-5 py-3 border-t border-[#30363d]">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="text-muted-foreground hover:text-foreground"
            onClick={onClose}
          >
            Cancel
          </Button>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="border-[#30363d] text-[#e6edf3] hover:bg-[#21262d]"
              onClick={handleSave}
            >
              Save Custom Style
            </Button>
            <Button
              type="button"
              size="sm"
              className="bg-[#00d4ff] text-[#0d1117] hover:bg-[#00d4ff]/90"
              onClick={handleApplyAll}
            >
              Apply All to Canvas
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

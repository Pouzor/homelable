import { Fragment, useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import {
  Globe, Router, Network, Server, Layers, Box, Container, HardDrive,
  Cpu, Wifi, Camera, Printer, Monitor, Laptop, Smartphone, PlugZap, Anchor, Package, Circle, Flame,
  Radio, Zap, Lightbulb, RadioTower, Share2,
  type LucideIcon,
} from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { t, useLocale } from '@/i18n'
import { useThemeStore } from '@/stores/themeStore'
import { useCanvasStore } from '@/stores/canvasStore'
import { MIN_HANDLES, clampHandles, sideDefault } from '@/utils/handleUtils'
import { THEMES } from '@/utils/themes'
import { applyOpacity } from '@/utils/colorUtils'
import type {
  NodeType, EdgeType, NodeTypeStyle, EdgeTypeStyle, CustomStyleDef, EdgePathStyle, EdgeLineStyle,
} from '@/types'
import { NODE_TYPE_LABELS, EDGE_TYPE_LABELS } from '@/types'
import {
  EDGE_LINE_STYLES, EDGE_LINE_STYLE_LABELS, EDGE_TYPE_BASE_WIDTH, EDGE_TYPE_DEFAULT_LINE,
  clampWidthMult, dashArrayFor,
} from '@/utils/edgeLineStyle'
import { MarkerShapePicker } from './MarkerShapePicker'

// ── Node types exposed for custom style, grouped by category (skip groupRect/group) ──

const NODE_TYPE_GROUPS: { types: NodeType[] }[] = [
  { types: ['isp', 'router', 'firewall', 'switch', 'server', 'nas', 'kvm', 'ap', 'printer'] },
  { types: ['proxmox', 'vm', 'lxc', 'docker_host', 'docker_container'] },
  { types: ['iot', 'camera', 'cpl'] },
  { types: ['zigbee_coordinator', 'zigbee_router', 'zigbee_enddevice'] },
  { types: ['zwave_coordinator', 'zwave_router', 'zwave_enddevice'] },
  { types: ['computer', 'laptop', 'mobile'] },
  { types: ['generic'] },
]

/** The group captions, written out so each is a dictionary-checkable literal.
 *  Zigbee / Z-Wave are protocol names and stay verbatim. */
function groupLabel(index: number): string {
  switch (index) {
    case 0: return t('Hardware')
    case 1: return t('Virtualization')
    case 2: return t('IoT')
    case 3: return t('Zigbee')
    case 4: return t('Z-Wave')
    case 5: return t('Personal')
    default: return t('Generic')
  }
}

const EDITABLE_EDGE_TYPES: EdgeType[] = ['ethernet', 'wifi', 'iot', 'vlan', 'virtual', 'cluster', 'fibre', 'electrical', 'zigbee_mesh']

const NODE_ICONS: Record<string, LucideIcon> = {
  isp: Globe, router: Router, firewall: Flame, switch: Network, server: Server, proxmox: Layers,
  vm: Box, lxc: Container, nas: HardDrive, iot: Cpu, ap: Wifi,
  camera: Camera, printer: Printer, computer: Monitor, laptop: Laptop, mobile: Smartphone, cpl: PlugZap,
  docker_host: Anchor, docker_container: Package,
  zigbee_coordinator: Radio, zigbee_router: Zap, zigbee_enddevice: Lightbulb,
  zwave_coordinator: RadioTower, zwave_router: Share2, zwave_enddevice: Lightbulb,
  generic: Circle,
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
    lineStyle: EDGE_TYPE_DEFAULT_LINE[edgeType],
    widthMult: 1,
    animated: 'none',
    arrowStart: 'none',
    arrowEnd: 'none',
    showLqi: false,
  }
}

/** Edge types the Zigbee import writes an LQI onto — the only ones worth
 *  offering the "show LQI" toggle for. */
const LQI_EDGE_TYPES: EdgeType[] = ['iot', 'zigbee_mesh']

// ── Edge line preview (renders the actual dash pattern + width) ────────────────

interface EdgeLineSwatchProps {
  color: string
  lineStyle: EdgeLineStyle
  strokeWidth: number
  width?: number
}

function EdgeLineSwatch({ color, lineStyle, strokeWidth, width = 40 }: EdgeLineSwatchProps) {
  const h = 12
  return (
    <svg width={width} height={h} className="shrink-0" aria-hidden>
      <line
        x1={2}
        y1={h / 2}
        x2={width - 2}
        y2={h / 2}
        stroke={color}
        strokeWidth={strokeWidth}
        strokeDasharray={dashArrayFor(lineStyle, strokeWidth)}
        strokeLinecap={lineStyle === 'dotted' ? 'round' : 'butt'}
      />
    </svg>
  )
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
  useLocale()
  const set = useCallback(<K extends keyof NodeTypeStyle>(k: K, v: NodeTypeStyle[K]) => {
    onChange({ ...style, [k]: v })
  }, [style, onChange])

  return (
    <div className="flex flex-col gap-4">
      <div className="text-sm font-semibold text-[#e6edf3]">{NODE_TYPE_LABELS[nodeType]}</div>
      <div className="flex flex-col gap-3">
        <ColorRow
          label={t('Border')}
          color={style.borderColor}
          opacity={style.borderOpacity}
          onColorChange={(v) => set('borderColor', v)}
          onOpacityChange={(v) => set('borderOpacity', v)}
        />
        <ColorRow
          label={t('Background')}
          color={style.bgColor}
          opacity={style.bgOpacity}
          onColorChange={(v) => set('bgColor', v)}
          onOpacityChange={(v) => set('bgOpacity', v)}
        />
        <ColorRow
          label={t('Icon')}
          color={style.iconColor}
          opacity={style.iconOpacity}
          onColorChange={(v) => set('iconColor', v)}
          onOpacityChange={(v) => set('iconOpacity', v)}
        />
      </div>

      <div className="border-t border-[#30363d] pt-3">
        <div className="text-xs text-[#8b949e] mb-1">{t('Default size')}</div>
        <div className="text-xs text-[#8b949e]/60 mb-2">{t('0 = auto (min 140 × 50 px, grows with content)')}</div>
        <div className="flex gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-[#8b949e]">W</span>
            <input
              type="number"
              min={0}
              step={10}
              value={style.width}
              onChange={(e) => set('width', parseInt(e.target.value, 10) || 0)}
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
              onChange={(e) => set('height', parseInt(e.target.value, 10) || 0)}
              className="w-20 h-7 text-xs bg-[#0d1117] border border-[#30363d] rounded px-2 text-[#e6edf3]"
            />
          </div>
        </div>
      </div>

      <div className="border-t border-[#30363d] pt-3">
        <div className="text-xs text-[#8b949e] mb-1">{t('Default connection points')}</div>
        <div className="text-xs text-[#8b949e]/60 mb-2">{t('New {type} nodes start with these (0–64 per side)', { type: NODE_TYPE_LABELS[nodeType] })}</div>
        <div className="grid grid-cols-2 gap-2">
          {([
            [t('Top'), 'top', 'topHandles'],
            [t('Right'), 'right', 'rightHandles'],
            [t('Bottom'), 'bottom', 'bottomHandles'],
            [t('Left'), 'left', 'leftHandles'],
          ] as const).map(([label, side, key]) => (
            <div key={side} className="flex items-center gap-2">
              <span className="text-xs text-[#8b949e] w-12">{label}</span>
              <input
                type="number"
                min={MIN_HANDLES}
                max={64}
                step={1}
                value={style[key] ?? sideDefault(side)}
                onChange={(e) => set(key, clampHandles(side, parseInt(e.target.value, 10)))}
                aria-label={t('{label} default connection points', { label })}
                className="w-16 h-7 text-xs bg-[#0d1117] border border-[#30363d] rounded px-2 text-[#e6edf3]"
              />
            </div>
          ))}
        </div>
      </div>

      <Button
        size="sm"
        className="self-start bg-[#00d4ff] text-[#0d1117] hover:bg-[#00d4ff]/90"
        onClick={onApplyToExisting}
      >
        {t('Apply to existing {type} nodes', { type: NODE_TYPE_LABELS[nodeType] })}
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
  useLocale()
  const set = useCallback(<K extends keyof EdgeTypeStyle>(k: K, v: EdgeTypeStyle[K]) => {
    onChange({ ...style, [k]: v })
  }, [style, onChange])

  return (
    <div className="flex flex-col gap-4">
      <div className="text-sm font-semibold text-[#e6edf3]">{EDGE_TYPE_LABELS[edgeType]}</div>
      <div className="flex flex-col gap-3">
        <ColorRow
          label={t('Color')}
          color={style.color}
          opacity={style.opacity}
          onColorChange={(v) => set('color', v)}
          onOpacityChange={(v) => set('opacity', v)}
        />
      </div>

      <div className="border-t border-[#30363d] pt-3 flex flex-col gap-3">
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-[#8b949e]">{t('Line style')}</span>
            <EdgeLineSwatch
              color={applyOpacity(style.color, style.opacity)}
              lineStyle={style.lineStyle}
              strokeWidth={EDGE_TYPE_BASE_WIDTH[edgeType] * style.widthMult}
              width={72}
            />
          </div>
          <div className="flex gap-2">
            {EDGE_LINE_STYLES.map((ls) => (
              <button
                key={ls}
                type="button"
                onClick={() => set('lineStyle', ls)}
                className="px-3 py-1 text-xs rounded border transition-colors"
                style={{
                  borderColor: style.lineStyle === ls ? '#00d4ff' : '#30363d',
                  background: style.lineStyle === ls ? '#00d4ff22' : 'transparent',
                  color: style.lineStyle === ls ? '#00d4ff' : '#8b949e',
                }}
              >
                {EDGE_LINE_STYLE_LABELS[ls]}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-[#8b949e]">{t('Line width')}</span>
            <span className="text-xs text-[#8b949e]">{style.widthMult}×</span>
          </div>
          <input
            type="range"
            min={1}
            max={4}
            step={1}
            value={style.widthMult}
            onChange={(e) => set('widthMult', clampWidthMult(parseInt(e.target.value, 10)))}
            aria-label={t('Line width multiplier')}
            className="w-full h-1 accent-[#00d4ff]"
          />
        </div>

        <div>
          <div className="text-xs text-[#8b949e] mb-2">{t('Path style')}</div>
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
                {t(ps === 'bezier' ? 'Bezier' : 'Smooth')}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="text-xs text-[#8b949e] mb-2">{t('Animation')}</div>
          <select
            value={style.animated}
            onChange={(e) => set('animated', e.target.value as EdgeTypeStyle['animated'])}
            className="w-full h-7 text-xs bg-[#0d1117] border border-[#30363d] rounded px-2 text-[#e6edf3]"
          >
            <option value="none">{t('None')}</option>
            <option value="basic">{t('Basic')}</option>
            <option value="flow">{t('Flow')}</option>
            <option value="snake">{t('Snake')}</option>
          </select>
        </div>

        <div>
          <div className="text-xs text-[#8b949e] mb-2">{t('Endpoints')}</div>
          <div className="flex flex-col gap-1.5">
            <MarkerShapePicker label={t('Start')} value={style.arrowStart} onChange={(s) => set('arrowStart', s)} />
            <MarkerShapePicker label={t('End')} value={style.arrowEnd} onChange={(s) => set('arrowEnd', s)} />
          </div>
        </div>

        {/* Only the Zigbee-imported types carry an LQI; a link without one
            prints nothing either way, so the toggle stays where it means
            something. Applies live — no "Apply to existing" round-trip. */}
        {LQI_EDGE_TYPES.includes(edgeType) && (
          <label className="flex items-center gap-2 text-xs text-[#8b949e] cursor-pointer">
            <input
              type="checkbox"
              checked={style.showLqi ?? false}
              onChange={(e) => set('showLqi', e.target.checked)}
              className="accent-[#00d4ff] cursor-pointer"
            />
            {t('Show LQI on the link')}
          </label>
        )}
      </div>

      <Button
        size="sm"
        className="self-start bg-[#00d4ff] text-[#0d1117] hover:bg-[#00d4ff]/90"
        onClick={onApplyToExisting}
      >
        {t('Apply to existing {type} edges', { type: EDGE_TYPE_LABELS[edgeType] })}
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
  /** When opening, preselect this node type's editor (shortcut from NodeModal). */
  initialNodeType?: NodeType
}

export function CustomStyleModal({ open, onClose, initialNodeType }: CustomStyleModalProps) {
  useLocale()
  const { customStyle, setCustomStyle } = useThemeStore()
  const { markUnsaved, applyTypeNodeStyle, applyTypeEdgeStyle, applyAllCustomStyles } = useCanvasStore()

  const [tab, setTab] = useState<Tab>('nodes')
  const [selection, setSelection] = useState<Selection>(null)
  const [draft, setDraft] = useState<CustomStyleDef>(() => ({
    nodes: { ...customStyle.nodes },
    edges: { ...customStyle.edges },
  }))

  // Reset the draft to the saved customStyle whenever the modal is (re)opened.
  // The parent keeps this component mounted and only toggles `open`, so Radix's
  // onOpenChange never fires for a parent-driven open — we key off the prop edge
  // instead. Without this, abandoned edits (Cancel) would leak into the next open.
  useEffect(() => {
    if (open) {
      setDraft({ nodes: { ...customStyle.nodes }, edges: { ...customStyle.edges } })
      if (initialNodeType) {
        setTab('nodes')
        setSelection({ kind: 'node', type: initialNodeType })
      } else {
        setSelection(null)
      }
    }
    // Intentional snapshot-on-open: we don't want live customStyle changes to
    // clobber an in-progress edit, only a fresh open should reset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const handleOpen = (isOpen: boolean) => {
    if (!isOpen) onClose()
  }

  const getNodeStyle = (t: NodeType): NodeTypeStyle =>
    draft.nodes[t] ?? defaultNodeStyle(t)

  const getEdgeStyle = (t: EdgeType): EdgeTypeStyle =>
    draft.edges[t] ?? defaultEdgeStyle(t)

  const handleNodeChange = (t: NodeType, s: NodeTypeStyle) =>
    setDraft((d) => ({ ...d, nodes: { ...d.nodes, [t]: s } }))

  const handleEdgeChange = (t: EdgeType, s: EdgeTypeStyle) =>
    setDraft((d) => ({ ...d, edges: { ...d.edges, [t]: s } }))

  // Params are `type`, not `t`: `t` is the translator inside this component.
  const handleApplyNodeType = (type: NodeType) => {
    applyTypeNodeStyle(type, getNodeStyle(type))
    toast.success(t('Applied style to all {type} nodes', { type: NODE_TYPE_LABELS[type] }))
  }

  const handleApplyEdgeType = (type: EdgeType) => {
    applyTypeEdgeStyle(type, getEdgeStyle(type))
    toast.success(t('Applied style to all {type} edges', { type: EDGE_TYPE_LABELS[type] }))
  }

  const handleSave = () => {
    setCustomStyle(draft)
    markUnsaved()
    toast.success(t('Custom style saved — save your canvas to persist'))
    onClose()
  }

  const handleApplyAll = () => {
    setCustomStyle(draft)
    applyAllCustomStyles(draft)
    markUnsaved()
    toast.success(t('Custom style applied to all nodes and edges'))
    onClose()
  }

  const selectedNodeStyle = selection?.kind === 'node' ? getNodeStyle(selection.type) : null
  const selectedEdgeStyle = selection?.kind === 'edge' ? getEdgeStyle(selection.type) : null

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogContent className="bg-[#161b22] border-[#30363d] max-w-[calc(100%-2rem)] sm:max-w-3xl max-h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-[#30363d]">
          <DialogTitle className="text-sm font-semibold">{t('Custom Style Editor')}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-1 overflow-hidden min-h-0">
          {/* Left panel — type list */}
          <div className="w-52 shrink-0 border-r border-[#30363d] flex flex-col overflow-hidden">
            {/* Tabs */}
            <div className="flex border-b border-[#30363d]">
              {(['nodes', 'edges'] as Tab[]).map((tabKey) => (
                <button
                  key={tabKey}
                  type="button"
                  onClick={() => { setTab(tabKey); setSelection(null) }}
                  className="flex-1 py-2 text-xs font-medium transition-colors"
                  style={{
                    borderBottom: tab === tabKey ? '2px solid #00d4ff' : '2px solid transparent',
                    color: tab === tabKey ? '#00d4ff' : '#8b949e',
                  }}
                >
                  {t(tabKey === 'nodes' ? 'Nodes' : 'Edges')}
                </button>
              ))}
            </div>

            {/* Type list */}
            <div className="flex-1 overflow-y-auto py-1">
              {tab === 'nodes' && NODE_TYPE_GROUPS.map((group, gi) => (
                <Fragment key={group.types[0]}>
                  <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[#8b949e]/60">
                    {groupLabel(gi)}
                  </div>
                  {group.types.map((nodeType) => {
                    const Icon = NODE_ICONS[nodeType] ?? Circle
                    const style = draft.nodes[nodeType]
                    const isSelected = selection?.kind === 'node' && selection.type === nodeType
                    const swatchColor = style
                      ? applyOpacity(style.borderColor, style.borderOpacity)
                      : THEMES.default.colors.nodeAccents[nodeType]?.border ?? '#8b949e'

                    return (
                      <button
                        key={nodeType}
                        type="button"
                        onClick={() => setSelection({ kind: 'node', type: nodeType })}
                        className="w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors text-left"
                        style={{
                          background: isSelected ? '#21262d' : 'transparent',
                          color: isSelected ? '#e6edf3' : '#8b949e',
                        }}
                      >
                        <Icon size={13} />
                        <span className="flex-1 truncate">{NODE_TYPE_LABELS[nodeType]}</span>
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ background: swatchColor }}
                        />
                      </button>
                    )
                  })}
                </Fragment>
              ))}

              {tab === 'edges' && EDITABLE_EDGE_TYPES.map((edgeType) => {
                const style = draft.edges[edgeType]
                const isSelected = selection?.kind === 'edge' && selection.type === edgeType
                const swatchColor = style
                  ? applyOpacity(style.color, style.opacity)
                  : THEMES.default.colors.edgeColors[edgeType]
                const lineStyle = style?.lineStyle ?? EDGE_TYPE_DEFAULT_LINE[edgeType]
                const widthMult = clampWidthMult(style?.widthMult)

                return (
                  <button
                    key={edgeType}
                    type="button"
                    onClick={() => setSelection({ kind: 'edge', type: edgeType })}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors text-left"
                    style={{
                      background: isSelected ? '#21262d' : 'transparent',
                      color: isSelected ? '#e6edf3' : '#8b949e',
                    }}
                  >
                    <span className="flex-1 truncate">{EDGE_TYPE_LABELS[edgeType]}</span>
                    <EdgeLineSwatch
                      color={swatchColor}
                      lineStyle={lineStyle}
                      strokeWidth={EDGE_TYPE_BASE_WIDTH[edgeType] * widthMult}
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
                {t('Select a {kind} from the list to edit its style', { kind: tab === 'nodes' ? t('node type') : t('edge type') })}
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
            {t('Cancel')}
          </Button>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="border-[#30363d] text-[#e6edf3] hover:bg-[#21262d]"
              onClick={handleSave}
            >
              {t('Save Custom Style')}
            </Button>
            <Button
              type="button"
              size="sm"
              className="bg-[#00d4ff] text-[#0d1117] hover:bg-[#00d4ff]/90"
              onClick={handleApplyAll}
            >
              {t('Apply All to Canvas')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

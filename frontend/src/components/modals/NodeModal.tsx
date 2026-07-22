import { Fragment, createElement, useState } from 'react'
import modalStyles from './modal-interactive.module.css'
import { RotateCcw, ChevronDown, Palette } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select'
import { NODE_TYPE_LABELS, type NodeData, type NodeType, type CheckMethod, type NodeTypeStyle } from '@/types'
import { useThemeStore } from '@/stores/themeStore'
import { resolveNodeColors } from '@/utils/nodeColors'
import { ICON_REGISTRY, ICON_CATEGORIES, NODE_TYPE_DEFAULT_ICONS, isBrandIconKey, brandIconSlug, brandIconUrl } from '@/utils/nodeIcons'
import { BrandIconPicker } from './BrandIconPicker'
import { MAX_HANDLES, clampHandles, sideDefault, handleCountField, type Side } from '@/utils/handleUtils'
import { getValidParentTypes } from '@/utils/virtualEdgeParent'

const NODE_TYPE_GROUPS: { label: string; types: NodeType[] }[] = [
  { label: 'Hardware',       types: ['isp', 'router', 'firewall', 'switch', 'server', 'nas', 'ap', 'printer'] },
  { label: 'Virtualization', types: ['proxmox', 'vm', 'lxc', 'docker_host', 'docker_container'] },
  { label: 'IoT',            types: ['iot', 'camera', 'cpl'] },
  { label: 'Zigbee',         types: ['zigbee_coordinator', 'zigbee_router', 'zigbee_enddevice'] },
  { label: 'Z-Wave',         types: ['zwave_coordinator', 'zwave_router', 'zwave_enddevice'] },
  { label: 'Personal',       types: ['computer', 'laptop', 'mobile'] },
  { label: 'Electrical',     types: ['grid', 'ups', 'battery', 'generator', 'solar_panel', 'inverter', 'circuit_breaker', 'contactor', 'electrical_switch', 'socket', 'light', 'meter', 'transformer', 'load'] },
  { label: 'Generic',        types: ['generic', 'groupRect'] },
]

// Maps a side to its per-type default field on NodeTypeStyle.
const SIDE_STYLE_KEY: Record<Side, keyof NodeTypeStyle> = {
  top: 'topHandles',
  bottom: 'bottomHandles',
  left: 'leftHandles',
  right: 'rightHandles',
}

/**
 * Compact per-side connection-point control: [− N +] with a typable value.
 * Placed spatially around a node preview (see the Connection Points section).
 */
function CPStepper({ label, side, value, onChange }: {
  label: string
  side: Side
  value: number
  onChange: (v: number) => void
}) {
  const min = sideDefault(side)
  const labelEl = <span className="text-[10px] text-muted-foreground/80 leading-none">{label}</span>
  const belowLabel = side === 'bottom'
  const btn = 'w-6 h-full flex items-center justify-center text-sm text-muted-foreground hover:text-foreground hover:bg-[#21262d] disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-default'
  return (
    <div className="flex flex-col items-center gap-1">
      {!belowLabel && labelEl}
      <div className="flex items-center h-7 rounded-md border border-[#30363d] bg-[#0d1117] overflow-hidden">
        <button
          type="button"
          aria-label={`Decrease ${label} connection points`}
          onClick={() => onChange(clampHandles(side, value - 1))}
          disabled={value <= min}
          className={btn}
        >
          −
        </button>
        <input
          type="number"
          min={min}
          max={MAX_HANDLES}
          value={value}
          aria-label={`${label} connection points`}
          onChange={(e) => onChange(clampHandles(side, Number(e.target.value)))}
          className="w-9 h-full bg-transparent text-center text-xs font-mono text-foreground outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        <button
          type="button"
          aria-label={`Increase ${label} connection points`}
          onClick={() => onChange(clampHandles(side, value + 1))}
          disabled={value >= MAX_HANDLES}
          className={btn}
        >
          +
        </button>
      </div>
      {belowLabel && labelEl}
    </div>
  )
}

const CHECK_METHODS: CheckMethod[] = ['none', 'ping', 'http', 'https', 'tcp', 'ssh', 'prometheus', 'health']
const CONTAINER_MODE_TYPES: NodeType[] = ['proxmox', 'vm', 'lxc', 'docker_host']
const ZIGBEE_TYPES: NodeType[] = ['zigbee_coordinator', 'zigbee_router', 'zigbee_enddevice']
const ZWAVE_TYPES: NodeType[] = ['zwave_coordinator', 'zwave_router', 'zwave_enddevice']
// Mesh radio devices aren't IP-reachable, so they default to no status check.
const MESH_TYPES: NodeType[] = [...ZIGBEE_TYPES, ...ZWAVE_TYPES]

const CHECK_METHOD_LABELS: Record<CheckMethod, string> = {
  none: 'None',
  ping: 'Ping',
  http: 'HTTP',
  https: 'HTTPS',
  tcp: 'TCP',
  ssh: 'SSH',
  prometheus: 'Prometheus',
  health: 'Health',
}

const DEFAULT_DATA: Partial<NodeData> = {
  type: 'server',
  label: '',
  hostname: '',
  ip: '',
  status: 'unknown',
  check_method: 'ping',
  services: [],
  container_mode: false,
  custom_colors: undefined,
  custom_icon: undefined,
}

interface ParentCandidate {
  id: string
  label: string
  type: NodeType
  /** True when the node has container mode on, so any node can nest inside it. */
  container_mode?: boolean
}

interface NodeModalProps {
  open: boolean
  onClose: () => void
  onSubmit: (data: Partial<NodeData>) => void
  initial?: Partial<NodeData>
  title?: string
  parentCandidates?: ParentCandidate[]
  currentNodeId?: string
  /** Shortcut: open the Custom Style editor for this node's type (canvas-wide). */
  onEditTypeStyle?: (type: NodeType) => void
}

// NodeModal is always mounted with a key that changes on open/edit, so useState
// initial value is enough - no need for a reset effect.
export function NodeModal({ open, onClose, onSubmit, initial, title = 'Add Node', parentCandidates = [], currentNodeId, onEditTypeStyle }: NodeModalProps) {
  const merged = { ...DEFAULT_DATA, ...initial }
  if (MESH_TYPES.includes((merged.type ?? '') as NodeType)) merged.check_method = 'none'
  const [form, setForm] = useState<Partial<NodeData>>(merged)
  const [iconSearch, setIconSearch] = useState('')
  const [iconPickerOpen, setIconPickerOpen] = useState(false)
  const [iconTab, setIconTab] = useState<'generic' | 'brand'>(isBrandIconKey(initial?.custom_icon) ? 'brand' : 'generic')
  const [labelError, setLabelError] = useState(false)
  const resolvedNodeColors = resolveNodeColors({ type: form.type ?? 'generic', custom_colors: form.custom_colors })
  const showServicesEnabled = form.custom_colors?.show_services === true
  const hasAppearanceOverrides = Boolean(
    form.custom_colors?.border
    || form.custom_colors?.background
    || form.custom_colors?.icon
  )

  const set = (key: keyof NodeData, value: unknown) =>
    setForm((f) => ({ ...f, [key]: value }))

  const customStyle = useThemeStore((s) => s.customStyle)
  // Effective default count for a side: the per-type style default if set,
  // otherwise the intrinsic side default (top/bottom → 1, left/right → 0).
  const effectiveSideDefault = (side: Side): number => {
    const styleVal = customStyle.nodes[(form.type ?? 'generic') as NodeType]?.[SIDE_STYLE_KEY[side]]
    return clampHandles(side, typeof styleVal === 'number' ? styleVal : sideDefault(side))
  }
  const sideValue = (side: Side): number =>
    clampHandles(side, form[handleCountField(side)] ?? effectiveSideDefault(side))

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.label?.trim()) {
      setLabelError(true)
      return
    }
    setLabelError(false)
    const selectedType = (form.type ?? 'generic') as NodeType
    const canUseContainerMode = CONTAINER_MODE_TYPES.includes(selectedType)
    const validParentTypes = getValidParentTypes(selectedType)
    // A parent is valid either by the type rules (lxc/vm/docker_container) or
    // because the candidate is a container-mode node (any child can nest in it).
    const isValidParent = (p: ParentCandidate) =>
      validParentTypes.includes(p.type) || p.container_mode === true
    let safeParentId = form.parent_id
    if (safeParentId) {
      const parent = parentCandidates.find((n) => n.id === safeParentId)
      if (!parent || !isValidParent(parent)) safeParentId = undefined
    }
    const isGroupType = selectedType === 'groupRect' || selectedType === 'group'
    onSubmit({
      ...form,
      // Persist the resolved per-side counts so type-style defaults (and
      // untouched sliders) are baked into the node. Skipped for group types.
      ...(isGroupType ? {} : {
        top_handles: sideValue('top'),
        bottom_handles: sideValue('bottom'),
        left_handles: sideValue('left'),
        right_handles: sideValue('right'),
      }),
      parent_id: safeParentId,
      container_mode: canUseContainerMode ? !!form.container_mode : false,
    })
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-[#161b22] border-[#30363d] text-foreground max-w-[calc(100%-2rem)] sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold">{title}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 mt-2">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
            {/* ── LEFT column: identity & network ── */}
            <div className="flex flex-col gap-4 min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70 pb-1 border-b border-[#30363d]">Information</div>
            <div className="grid grid-cols-2 gap-3">
            {/* Type + Icon on the same row */}
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">Type</Label>
              <Select value={form.type} onValueChange={(v) => {
                const t = v as NodeType
                setForm((f) => {
                  const next: Partial<NodeData> = { ...f, type: t }
                  if (MESH_TYPES.includes(t)) next.check_method = 'none' as CheckMethod
                  // Drop the parent only if it's no longer a valid target for the
                  // new type — keep container-mode parents (any node can nest).
                  const parent = parentCandidates.find((n) => n.id === f.parent_id)
                  if (f.parent_id && !(parent && (getValidParentTypes(t).includes(parent.type) || parent.container_mode === true))) {
                    next.parent_id = undefined
                  }
                  return next
                })
              }}>
                <SelectTrigger className={`bg-[#21262d] border-[#30363d] text-sm h-8 w-full cursor-pointer ${modalStyles['modal-interactive']} ${modalStyles['modal-radius']}`} aria-label="Node type selector">
                  <SelectValue>{NODE_TYPE_LABELS[(form.type ?? 'server') as NodeType]}</SelectValue>
                </SelectTrigger>
                <SelectContent className="bg-[#21262d] border-[#30363d]">
                  {NODE_TYPE_GROUPS.map((group, i) => (
                    <Fragment key={group.label}>
                      {i > 0 && <SelectSeparator className="bg-[#30363d]" />}
                      <SelectGroup>
                        <SelectLabel className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 px-2 py-1">
                          {group.label}
                        </SelectLabel>
                        {group.types.map((type) => (
                          <SelectItem key={type} value={type} className="text-sm pl-4">
                            {NODE_TYPE_LABELS[type]}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </Fragment>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Icon */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">Icon</Label>
                {form.custom_icon && (
                  <button
                    type="button"
                    onClick={() => { set('custom_icon', undefined); setIconPickerOpen(false) }}
                    className="flex items-center gap-1 text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
                  >
                    <RotateCcw size={10} /> Reset
                  </button>
                )}
              </div>
              {/* Trigger button */}
              <button
                type="button"
                onClick={() => setIconPickerOpen((o) => !o)}
                className={`flex items-center justify-between gap-2 h-8 px-3 bg-[#21262d] border border-[#30363d] text-sm transition-colors w-full cursor-pointer ${modalStyles['modal-interactive']} ${modalStyles['modal-radius']}`}
                aria-label="Icon picker trigger"
              >
                <span className="flex items-center gap-2 min-w-0">
                  {(() => {
                    if (isBrandIconKey(form.custom_icon)) {
                      const slug = brandIconSlug(form.custom_icon!)
                      return <><img src={brandIconUrl(slug)} alt={slug} width={13} height={13} className="shrink-0" style={{ width: 13, height: 13, objectFit: 'contain' }} /><span className="text-foreground truncate">{slug}</span></>
                    }
                    const entry = ICON_REGISTRY.find((e) => e.key === form.custom_icon)
                    if (entry) {
                      return <>{createElement(entry.icon, { size: 13, className: 'text-[#00d4ff] shrink-0' })}<span className="text-foreground truncate">{entry.label}</span></>
                    }
                    const defaultIcon = NODE_TYPE_DEFAULT_ICONS[form.type as NodeType] ?? NODE_TYPE_DEFAULT_ICONS.generic
                    return <>{createElement(defaultIcon, { size: 13, className: 'text-muted-foreground shrink-0' })}<span className="text-muted-foreground truncate">Default</span></>
                  })()}
                </span>
                <ChevronDown size={12} className="text-muted-foreground shrink-0" style={{ transform: iconPickerOpen ? 'rotate(180deg)' : undefined, transition: 'transform 0.15s' }} />
              </button>
            </div>
            </div>{/* end Type/Icon subgrid */}

            {/* Inline icon picker - full width, shown below the type+icon row */}
            {iconPickerOpen && (
              <div className="flex flex-col gap-2 p-2.5 rounded-md bg-[#0d1117] border border-[#30363d] col-span-2">
                <div className="flex gap-1 mb-1" role="tablist" aria-label="Icon source">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={iconTab === 'generic'}
                    onClick={() => setIconTab('generic')}
                    className={`text-[11px] px-2 py-1 rounded transition-colors cursor-pointer ${
                      iconTab === 'generic' ? 'bg-[#21262d] text-foreground border border-[#30363d]' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Generic
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={iconTab === 'brand'}
                    onClick={() => setIconTab('brand')}
                    className={`text-[11px] px-2 py-1 rounded transition-colors cursor-pointer ${
                      iconTab === 'brand' ? 'bg-[#21262d] text-foreground border border-[#30363d]' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Brand
                  </button>
                </div>
                {iconTab === 'brand' ? (
                  <BrandIconPicker
                    value={form.custom_icon}
                    onSelect={(key) => { set('custom_icon', key); setIconPickerOpen(false) }}
                  />
                ) : (
                <>
                <Input
                  value={iconSearch}
                  onChange={(e) => setIconSearch(e.target.value)}
                  placeholder="Search icons…"
                  className={`bg-[#21262d] border-[#30363d] text-xs h-7 ${modalStyles['modal-radius']}`}
                  autoFocus
                />
                <div className="flex flex-col gap-2 max-h-52 overflow-y-auto">
                  {ICON_CATEGORIES.map((cat) => {
                    const entries = ICON_REGISTRY.filter(
                      (e) => e.category === cat &&
                        (iconSearch === '' || e.label.toLowerCase().includes(iconSearch.toLowerCase()) || e.key.includes(iconSearch.toLowerCase()))
                    )
                    if (entries.length === 0) return null
                    return (
                      <div key={cat}>
                        <p className="text-[9px] font-semibold text-muted-foreground/50 uppercase tracking-wider mb-1">{cat}</p>
                        <div className="grid grid-cols-7 gap-1">
                          {entries.map((entry) => {
                            const isSelected = form.custom_icon === entry.key
                            return (
                              <button
                                key={entry.key}
                                type="button"
                                title={entry.label}
                                onClick={() => { set('custom_icon', isSelected ? undefined : entry.key); setIconPickerOpen(false) }}
                                className={`flex items-center justify-center w-7 h-7 rounded transition-colors cursor-pointer ${modalStyles['modal-interactive']}`}
                                aria-label={`Select icon ${entry.label}`}
                                style={{
                                  background: isSelected ? '#00d4ff22' : 'transparent',
                                  border: isSelected ? '1px solid #00d4ff88' : '1px solid transparent',
                                  color: isSelected ? '#00d4ff' : '#8b949e',
                                }}
                                onMouseEnter={(e) => { if (!isSelected) (e.currentTarget as HTMLButtonElement).style.background = '#21262d' }}
                                onMouseLeave={(e) => { if (!isSelected) (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
                              >
                                {createElement(entry.icon, { size: 13 })}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
                </>
                )}
              </div>
            )}

            {/* Label */}
            <div className="flex flex-col gap-1.5 col-span-2">
              <Label className="text-xs text-muted-foreground">Label *</Label>
              <Input
                value={form.label ?? ''}
                onChange={(e) => { set('label', e.target.value); if (labelError) setLabelError(false) }}
                placeholder="My Server"
                className={`bg-[#21262d] text-sm h-8 ${labelError ? 'border-[#f85149] focus-visible:ring-[#f85149]' : 'border-[#30363d]'} ${modalStyles['modal-radius']}`}
              />
              {labelError && <p className="text-[11px] text-[#f85149]">Label is required</p>}
            </div>

            <div className="grid grid-cols-2 gap-3">
            {/* Hostname */}
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">Hostname</Label>
              <Input
                value={form.hostname ?? ''}
                onChange={(e) => set('hostname', e.target.value)}
                placeholder="server.lan"
                className={`bg-[#21262d] border-[#30363d] font-mono text-sm h-8 ${modalStyles['modal-radius']}`}
              />
            </div>

            {/* IP */}
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">IP Address</Label>
              <Input
                value={form.ip ?? ''}
                onChange={(e) => set('ip', e.target.value)}
                placeholder="192.168.1.x, 2001:db8::1"
                className={`bg-[#21262d] border-[#30363d] font-mono text-sm h-8 ${modalStyles['modal-radius']}`}
              />
              <span className="text-[10px] text-muted-foreground/50">comma-separated</span>
            </div>
            </div>{/* end Hostname/IP subgrid */}

            <div className="grid grid-cols-2 gap-3">
            {/* Check method — hidden for zigbee nodes (always none/online) */}
            {!ZIGBEE_TYPES.includes((form.type ?? '') as NodeType) && (
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs text-muted-foreground">Check Method</Label>
                <Select value={form.check_method ?? 'ping'} onValueChange={(v) => set('check_method', v as CheckMethod)}>
                  <SelectTrigger className={`bg-[#21262d] border-[#30363d] text-sm h-8 cursor-pointer ${modalStyles['modal-interactive']} ${modalStyles['modal-radius']}`} aria-label="Check method selector">
                    <SelectValue>{CHECK_METHOD_LABELS[(form.check_method ?? 'ping') as CheckMethod]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent className="bg-[#21262d] border-[#30363d]">
                    {CHECK_METHODS.map((m) => (
                      <SelectItem key={m} value={m} className="text-sm">{CHECK_METHOD_LABELS[m]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Check target — hidden for zigbee nodes */}
            {!ZIGBEE_TYPES.includes((form.type ?? '') as NodeType) && (
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs text-muted-foreground">Check Target</Label>
                <Input
                  value={form.check_target ?? ''}
                  onChange={(e) => set('check_target', e.target.value)}
                  placeholder="http://..."
                  className={`bg-[#21262d] border-[#30363d] font-mono text-sm h-8 ${modalStyles['modal-radius']}`}
                />
              </div>
            )}
            </div>{/* end Check method/target subgrid */}

            {/* Parent Container */}
            {(() => {
              const childType = (form.type ?? 'generic') as NodeType
              const validParentTypes = getValidParentTypes(childType)
              // Candidates: type-based parents (lxc/vm/docker_container) plus any
              // container-mode node. The current parent is always kept so an
              // already-nested node can be re-targeted or detached here.
              const validParents = parentCandidates.filter(
                (n) => n.id !== currentNodeId &&
                  (validParentTypes.includes(n.type) || n.container_mode === true || n.id === form.parent_id),
              )
              if (validParents.length === 0) return null
              return (
                <div className="flex flex-col gap-1.5 col-span-2">
                  <Label className="text-xs text-muted-foreground">Parent Container</Label>
                  <Select
                    value={form.parent_id ?? 'none'}
                    onValueChange={(v) => set('parent_id', v === 'none' ? undefined : v)}
                  >
                    <SelectTrigger className={`bg-[#21262d] border-[#30363d] text-sm h-8 cursor-pointer ${modalStyles['modal-interactive']} ${modalStyles['modal-radius']}`} aria-label="Parent container selector">
                      <SelectValue>
                        {form.parent_id
                          ? (validParents.find((n) => n.id === form.parent_id)?.label ?? 'None')
                          : 'None'}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent className="bg-[#21262d] border-[#30363d]">
                      <SelectItem value="none" className="text-sm">None</SelectItem>
                      {validParents.map((n) => (
                        <SelectItem key={n.id} value={n.id} className="text-sm">{n.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )
            })()}

            {/* Container mode */}
            {CONTAINER_MODE_TYPES.includes((form.type ?? 'generic') as NodeType) && (
              <div className="flex items-center justify-between col-span-2 py-1">
                <div className="flex flex-col gap-0.5">
                  <Label className="text-xs text-muted-foreground">Container Mode</Label>
                  <span className="text-[10px] text-muted-foreground/60">
                    Allow other nodes to nest inside this node
                  </span>
                </div>

                <button
                  type="button"
                  role="switch"
                  aria-label="Container Mode"
                  aria-checked={!!form.container_mode}
                  onClick={() => set('container_mode', !form.container_mode)}
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors focus:outline-none ${modalStyles['modal-interactive']}`}
                  style={{ background: form.container_mode ? '#ff6e00' : '#30363d' }}
                >
                  <span
                    className="pointer-events-none absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ease-in-out"
                    style={{
                      transform: form.container_mode ? 'translateX(16px)' : 'translateX(0)'
                    }}
                  />
                </button>
              </div>
            )}
            {/* Notes */}
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">Notes</Label>
              <Textarea
                value={form.notes ?? ''}
                onChange={(e) => set('notes', e.target.value)}
                placeholder="Optional notes"
                rows={3}
                className={`bg-[#21262d] border-[#30363d] text-sm resize-y min-h-16 ${modalStyles['modal-radius']}`}
              />
            </div>
            </div>{/* ── end LEFT column ── */}

            {/* ── RIGHT column: display ── */}
            <div className="flex flex-col gap-4 min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70 pb-1 border-b border-[#30363d]">Design</div>
            {/* Service visibility */}
            {form.type !== 'groupRect' && form.type !== 'group' && (
              <div className="flex items-start justify-between col-span-2 py-1">
                <div className="flex flex-col gap-0.5">
                  <Label className="text-xs text-muted-foreground">Show Services</Label>
                  <span className="text-[10px] text-muted-foreground/60">Display discovered services on the node card</span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-label="Show Services"
                  aria-checked={showServicesEnabled}
                  onClick={() => set('custom_colors', {
                    ...form.custom_colors,
                    show_services: !showServicesEnabled,
                  })}
                  className="relative inline-flex h-5 w-9 mt-1 shrink-0 cursor-pointer rounded-full transition-colors focus:outline-none"
                  style={{ background: showServicesEnabled ? resolvedNodeColors.icon : '#30363d' }}
                >
                  <span
                    className="pointer-events-none absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ease-in-out"
                    style={{ transform: showServicesEnabled ? 'translateX(16px)' : 'translateX(0)' }}
                  />
                </button>
              </div>
            )}

            {/* Appearance */}
            <div className="flex flex-col gap-2 col-span-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">Appearance</Label>
                {hasAppearanceOverrides && (
                  <button
                    type="button"
                    onClick={() => setForm((f) => {
                      if (!f.custom_colors) return f
                      const { border, background, icon, ...rest } = f.custom_colors
                      void border
                      void background
                      void icon
                      return {
                        ...f,
                        custom_colors: Object.keys(rest).length > 0 ? rest : undefined,
                      }
                    })}
                    className="flex items-center gap-1 text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
                  >
                    <RotateCcw size={10} /> Reset to defaults
                  </button>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2">
                {(['border', 'background', 'icon'] as const).map((key) => {
                  const resolved = resolveNodeColors({ type: form.type ?? 'generic', custom_colors: form.custom_colors })
                  const currentValue = resolved[key]
                  const isCustom = !!form.custom_colors?.[key]
                  return (
                    <div key={key} className="flex flex-col gap-1 items-center">
                      <label
                        className={`relative w-full h-7 rounded-md border cursor-pointer overflow-hidden transition-all ${modalStyles['modal-interactive']}`}
                        style={{ borderColor: isCustom ? currentValue : '#30363d' }}
                        title={`${key.charAt(0).toUpperCase() + key.slice(1)}: ${currentValue}`}
                        tabIndex={0}
                        aria-label={`Color picker for ${key}`}
                      >
                        <input
                          type="color"
                          value={currentValue}
                          onChange={(e) => set('custom_colors', { ...form.custom_colors, [key]: e.target.value })}
                          className="absolute inset-0 w-full h-full cursor-pointer opacity-0"
                        />
                        <div className="w-full h-full rounded-sm" style={{ background: currentValue }} />
                      </label>
                      <span className="text-[9px] text-muted-foreground/60 capitalize">{key}</span>
                    </div>
                  )
                })}
              </div>
              <div className="min-h-3.5">
                {!hasAppearanceOverrides && (
                  <p className="text-[10px] text-muted-foreground/50">Using default colors for {NODE_TYPE_LABELS[form.type ?? 'generic']}. Click a swatch to customize.</p>
                )}
              </div>
              {onEditTypeStyle && form.type !== 'group' && form.type !== 'groupRect' && (
                <button
                  type="button"
                  onClick={() => onEditTypeStyle((form.type ?? 'generic') as NodeType)}
                  className="flex items-center gap-1 self-start text-[10px] text-[#00d4ff] hover:underline"
                >
                  <Palette size={10} /> Edit {NODE_TYPE_LABELS[form.type ?? 'generic']} style for all nodes on the canvas
                </button>
              )}
            </div>

            {/* Connection points per side (not for group containers) */}
            {form.type !== 'groupRect' && form.type !== 'group' && (
              <div className="flex flex-col gap-2.5 col-span-2">
                <Label className="text-xs text-muted-foreground">Connection Points</Label>
                {/* Spatial cross: each side's stepper sits where that side is. */}
                <div className="grid grid-cols-[1fr_auto_1fr] items-center justify-items-center gap-x-2 gap-y-2 py-1">
                  <div />
                  <CPStepper label="Top" side="top" value={sideValue('top')}
                    onChange={(v) => set('top_handles', v)} />
                  <div />

                  <CPStepper label="Left" side="left" value={sideValue('left')}
                    onChange={(v) => set('left_handles', v)} />
                  <div
                    className="flex items-center justify-center rounded-md border text-[9px] uppercase tracking-wide font-medium select-none"
                    style={{
                      width: 64, height: 40,
                      borderColor: resolvedNodeColors.border,
                      background: `${resolvedNodeColors.background}`,
                      color: resolvedNodeColors.icon,
                    }}
                  >
                    node
                  </div>
                  <CPStepper label="Right" side="right" value={sideValue('right')}
                    onChange={(v) => set('right_handles', v)} />

                  <div />
                  <CPStepper label="Bottom" side="bottom" value={sideValue('bottom')}
                    onChange={(v) => set('bottom_handles', v)} />
                  <div />
                </div>
                <div className="flex items-center justify-between pt-1">
                  <div className="flex flex-col gap-0.5">
                    <Label className="text-xs text-muted-foreground">Show Port Numbers</Label>
                    <span className="text-[10px] text-muted-foreground/60">Label each connection point</span>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={!!form.show_port_numbers}
                    onClick={() => set('show_port_numbers', !form.show_port_numbers)}
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors focus:outline-none ${modalStyles['modal-interactive']}`}
                    tabIndex={0}
                    aria-label="Toggle port numbers"
                    style={{ background: form.show_port_numbers ? '#ff6e00' : '#30363d' }}
                  >
                    <span
                      className="pointer-events-none absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-all"
                      style={{ left: form.show_port_numbers ? 'calc(100% - 18px)' : '2px' }}
                    />
                  </button>
                </div>
              </div>
            )}

            </div>{/* ── end RIGHT column ── */}
          </div>

          <div className="flex justify-between gap-2 pt-1">
            {/* Show delete button only for edit mode (not add) */}
            {title !== 'Add Node' ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-[#f85149] hover:text-[#f85149] hover:bg-[#f85149]/10 cursor-pointer"
                onClick={() => {
                  if (window.confirm('Delete this node?')) {
                    onSubmit({ ...form, _delete: true })
                    onClose()
                  }
                }}
                style={{ minWidth: 64 }}
              >
                Delete
              </Button>
            ) : <span />}
            <div className="flex gap-2">
              <Button type="button" variant="ghost" size="sm" className={`cursor-pointer ${modalStyles['modal-cancel-hover']}`} onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                className="bg-[#00d4ff] text-[#0d1117] hover:bg-[#00d4ff]/90 cursor-pointer"
              >
                {title === 'Add Node' ? 'Add' : 'Save'}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
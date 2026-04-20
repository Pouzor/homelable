import { Fragment, createElement, useState } from 'react'
import modalStyles from './modal-interactive.module.css'
import { RotateCcw, ChevronDown } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select'
import { NODE_TYPE_LABELS, type NodeData, type NodeType, type CheckMethod } from '@/types'
import { resolveNodeColors } from '@/utils/nodeColors'
import { ICON_REGISTRY, ICON_CATEGORIES, NODE_TYPE_DEFAULT_ICONS } from '@/utils/nodeIcons'

const NODE_TYPE_GROUPS: { label: string; types: NodeType[] }[] = [
  { label: 'Hardware',       types: ['isp', 'router', 'switch', 'server', 'nas', 'ap', 'printer'] },
  { label: 'Virtualization', types: ['proxmox', 'vm', 'lxc', 'docker_host', 'docker_container'] },
  { label: 'IoT',            types: ['iot', 'camera', 'cpl'] },
  { label: 'Generic',        types: ['computer', 'generic', 'groupRect'] },
]

const CHECK_METHODS: CheckMethod[] = ['none', 'ping', 'http', 'https', 'tcp', 'ssh', 'prometheus', 'health']
const CONTAINER_MODE_TYPES: NodeType[] = ['proxmox', 'vm', 'lxc', 'docker_host']

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

interface NodeModalProps {
  open: boolean
  onClose: () => void
  onSubmit: (data: Partial<NodeData>) => void
  initial?: Partial<NodeData>
  title?: string
  parentContainerNodes?: { id: string; label: string; nodeType?: NodeType }[]
}

// NodeModal is always mounted with a key that changes on open/edit, so useState
// initial value is enough - no need for a reset effect.
export function NodeModal({ open, onClose, onSubmit, initial, title = 'Add Node', parentContainerNodes = [] }: NodeModalProps) {
  const [form, setForm] = useState<Partial<NodeData>>({ ...DEFAULT_DATA, ...initial })
  const [iconSearch, setIconSearch] = useState('')
  const [iconPickerOpen, setIconPickerOpen] = useState(false)
  const [labelError, setLabelError] = useState(false)
  const resolvedNodeColors = resolveNodeColors({ type: form.type ?? 'generic', custom_colors: form.custom_colors })

  const set = (key: keyof NodeData, value: unknown) =>
    setForm((f) => ({ ...f, [key]: value }))

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.label?.trim()) {
      setLabelError(true)
      return
    }
    setLabelError(false)
    const selectedType = (form.type ?? 'generic') as NodeType
    const canUseContainerMode = CONTAINER_MODE_TYPES.includes(selectedType)
    onSubmit({
      ...form,
      container_mode: canUseContainerMode ? !!form.container_mode : false,
    })
    onClose()
  }

  const filteredParentNodes = form.type === 'docker_container'
    ? parentContainerNodes.filter((n) => n.nodeType === 'docker_host')
    : parentContainerNodes

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-[#161b22] border-[#30363d] text-foreground max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold">{title}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 mt-2">
          <div className="grid grid-cols-2 gap-3">
            {/* Type + Icon on the same row */}
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">Type</Label>
              <Select value={form.type} onValueChange={(v) => set('type', v as NodeType)}>
                <SelectTrigger className={`bg-[#21262d] border-[#30363d] text-sm h-8 w-full cursor-pointer ${modalStyles['modal-interactive']} ${modalStyles['modal-radius']}`} aria-label="Node type selector">
                  <SelectValue>{NODE_TYPE_LABELS[(form.type ?? 'server') as NodeType]}</SelectValue>
                </SelectTrigger>
                <SelectContent className="bg-[#21262d] border-[#30363d]">
                  {NODE_TYPE_GROUPS.map((group, i) => (
                    <Fragment key={group.label}>
                      {i > 0 && <SelectSeparator key={`sep-${group.label}`} className="bg-[#30363d]" />}
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

            {/* Inline icon picker - full width, shown below the type+icon row */}
            {iconPickerOpen && (
              <div className="flex flex-col gap-2 p-2.5 rounded-md bg-[#0d1117] border border-[#30363d] col-span-2">
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

            {/* Check method */}
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

            {/* Check target */}
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">Check Target</Label>
              <Input
                value={form.check_target ?? ''}
                onChange={(e) => set('check_target', e.target.value)}
                placeholder="http://..."
                className={`bg-[#21262d] border-[#30363d] font-mono text-sm h-8 ${modalStyles['modal-radius']}`}
              />
            </div>

            {/* Parent container */}
            {form.type !== 'groupRect' && form.type !== 'group' && filteredParentNodes.length > 0 && (
              <div className="flex flex-col gap-1.5 col-span-2">
                <Label className="text-xs text-muted-foreground">Parent Container</Label>
                <Select
                  value={form.parent_id ?? 'none'}
                  onValueChange={(v) => set('parent_id', v === 'none' ? undefined : v)}
                >
                  <SelectTrigger className={`bg-[#21262d] border-[#30363d] text-sm h-8 cursor-pointer ${modalStyles['modal-interactive']} ${modalStyles['modal-radius']}`} aria-label="Parent container selector">
                    <SelectValue placeholder="None (standalone)">
                      {form.parent_id
                        ? (filteredParentNodes.find((n) => n.id === form.parent_id)?.label ?? 'None (standalone)')
                        : 'None (standalone)'}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent className="bg-[#21262d] border-[#30363d]">
                    <SelectItem value="none" className="text-sm">None (standalone)</SelectItem>
                    {filteredParentNodes.map((n) => (
                      <SelectItem key={n.id} value={n.id} className="text-sm">{n.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Container mode */}
            {CONTAINER_MODE_TYPES.includes((form.type ?? 'generic') as NodeType) && (
              <div className="flex items-center justify-between col-span-2 py-1">
                <div className="flex flex-col gap-0.5">
                  <Label className="text-xs text-muted-foreground">Container Mode</Label>
                  <span className="text-[10px] text-muted-foreground/60">Allow other nodes to nest inside this node</span>
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
                    className="pointer-events-none absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-all"
                    style={{ left: form.container_mode ? 'calc(100% - 18px)' : '2px' }}
                  />
                </button>
              </div>
            )}

            {/* Service visibility */}
            {form.type !== 'groupRect' && form.type !== 'group' && (
              <div className="flex items-center justify-between col-span-2 py-1">
                <div className="flex flex-col gap-0.5">
                  <Label className="text-xs text-muted-foreground">Show Services</Label>
                  <span className="text-[10px] text-muted-foreground/60">Display discovered services on the node card</span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-label="Show Services"
                  aria-checked={form.custom_colors?.show_services === true}
                  onClick={() => set('custom_colors', {
                    ...form.custom_colors,
                    show_services: !(form.custom_colors?.show_services === true),
                  })}
                  className="relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus:outline-none"
                  style={{ background: form.custom_colors?.show_services === true ? resolvedNodeColors.icon : '#30363d' }}
                >
                  <span
                    className="pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform"
                    style={{ transform: form.custom_colors?.show_services === true ? 'translateX(16px)' : 'translateX(0)' }}
                  />
                </button>
              </div>
            )}

            {/* Appearance */}
            <div className="flex flex-col gap-2 col-span-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">Appearance</Label>
                {form.custom_colors && (
                  <button
                    type="button"
                    onClick={() => set('custom_colors', undefined)}
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
              {!form.custom_colors && (
                <p className="text-[10px] text-muted-foreground/50">Using default colors for {NODE_TYPE_LABELS[form.type ?? 'generic']}. Click a swatch to customize.</p>
              )}
            </div>

            {/* Bottom connection points (not for group containers) */}
            {form.type !== 'groupRect' && form.type !== 'group' && (
              <div className="flex flex-col gap-1.5 col-span-2">
                <Label className="text-xs text-muted-foreground">Bottom Connection Points</Label>
                <Select
                  value={String(form.bottom_handles ?? 1)}
                  onValueChange={(v) => set('bottom_handles', parseInt(v ?? '1', 10))}
                >
                  <SelectTrigger className={`bg-[#21262d] border-[#30363d] text-sm h-8 cursor-pointer ${modalStyles['modal-interactive']} ${modalStyles['modal-radius']}`} aria-label="Bottom connection points selector">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-[#21262d] border-[#30363d]">
                    <SelectItem value="1" className="text-sm">1 - center</SelectItem>
                    <SelectItem value="2" className="text-sm">2 - left / right</SelectItem>
                    <SelectItem value="3" className="text-sm">3 - left / center / right</SelectItem>
                    <SelectItem value="4" className="text-sm">4 - evenly spaced</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Notes */}
            <div className="flex flex-col gap-1.5 col-span-2">
              <Label className="text-xs text-muted-foreground">Notes</Label>
              <Input
                value={form.notes ?? ''}
                onChange={(e) => set('notes', e.target.value)}
                placeholder="Optional notes"
                className={`bg-[#21262d] border-[#30363d] text-sm h-8 ${modalStyles['modal-radius']}`}
              />
            </div>
          </div>

          <div className="flex justify-between gap-2 pt-1">
            {/* Show delete button only for edit mode (not add) */}
            {title !== 'Add Node' ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-[#f85149] hover:text-[#f85149] hover:bg-[#f85149]/10 cursor-pointer"
                onClick={() => { if (window.confirm('Delete this node?')) onSubmit({ ...form, _delete: true }); onClose(); }}
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
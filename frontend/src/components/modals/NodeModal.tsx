import { Fragment, createElement, useEffect, useMemo, useState } from 'react'
import { RotateCcw, ChevronDown } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select'
import { NODE_TYPE_LABELS, type NodeData, type NodeType, type CheckMethod, type NodeDimensions } from '@/types'
import { resolveNodeColors } from '@/utils/nodeColors'
import { ICON_REGISTRY, ICON_CATEGORIES, NODE_TYPE_DEFAULT_ICONS } from '@/utils/nodeIcons'
import { COLOR_SWATCHES } from '@/utils/colorPalettes'
import { useSettingsStore } from '@/stores/settingsStore'

const NODE_TYPE_GROUPS: { label: string; types: NodeType[] }[] = [
  { label: 'Hardware',       types: ['isp', 'router', 'switch', 'server', 'nas', 'ap', 'printer'] },
  { label: 'Virtualization', types: ['proxmox', 'vm', 'lxc', 'docker'] },
  { label: 'IoT',            types: ['iot', 'camera', 'cpl'] },
  { label: 'Generic',        types: ['computer', 'generic', 'groupRect'] },
]

const CHECK_METHODS: CheckMethod[] = ['none', 'ping', 'http', 'https', 'tcp', 'ssh', 'prometheus', 'health']

const DEFAULT_DATA: Partial<NodeData> = {
  type: 'server',
  label: '',
  hostname: '',
  ip: '',
  status: 'unknown',
  check_method: 'ping',
  services: [],
  container_mode: true,
  custom_colors: undefined,
  custom_icon: undefined,
}

interface NodeModalProps {
  open: boolean
  onClose: () => void
  onSubmit: (data: Partial<NodeData>, dimensions?: NodeDimensions) => void
  initial?: Partial<NodeData>
  initialDimensions?: NodeDimensions
  title?: string
  proxmoxNodes?: { id: string; label: string }[]
}

const CHILD_TYPES: NodeType[] = ['vm', 'lxc']

// NodeModal is always mounted with a key that changes on open/edit, so useState
// initial value is enough — no need for a reset effect.
export function NodeModal({ open, onClose, onSubmit, initial, initialDimensions, title = 'Add Node', proxmoxNodes = [] }: NodeModalProps) {
  const defaultNodeColor = useSettingsStore((s) => s.defaultNodeColor)
  const nodeTypeColors = useSettingsStore((s) => s.nodeTypeColors)
  const getDefaultColors = (type: NodeType | undefined) => {
    const selectedColor = (type ? nodeTypeColors[type] : undefined) ?? defaultNodeColor
    return selectedColor ? {
      border: selectedColor,
      icon: selectedColor,
      background: `${selectedColor}1a`,
    } : undefined
  }
  const [form, setForm] = useState<Partial<NodeData>>({
    ...DEFAULT_DATA,
    ...initial,
    custom_colors: initial?.custom_colors ?? getDefaultColors(initial?.type ?? DEFAULT_DATA.type),
  })
  const [dimensions, setDimensions] = useState<NodeDimensions>({
    width: initialDimensions?.width,
    height: initialDimensions?.height,
  })
  const [iconSearch, setIconSearch] = useState('')
  const [iconPickerOpen, setIconPickerOpen] = useState(false)
  const [labelError, setLabelError] = useState(false)
  const hasHardwareData = !!(initial?.cpu_count || initial?.cpu_model || initial?.ram_gb || initial?.disk_gb)
  const [hardwareOpen, setHardwareOpen] = useState(hasHardwareData)

  const set = (key: keyof NodeData, value: unknown) =>
    setForm((f) => ({ ...f, [key]: value }))

  const defaultColors = useMemo(
    () => getDefaultColors((form.type as NodeType | undefined) ?? DEFAULT_DATA.type),
    [form.type, nodeTypeColors, defaultNodeColor],
  )

  useEffect(() => {
    if (initial?.custom_colors) return
    setForm((current) => {
      if (current.custom_colors?.border || current.custom_colors?.background || current.custom_colors?.icon) {
        return current
      }
      return { ...current, custom_colors: defaultColors }
    })
  }, [defaultColors, initial?.custom_colors])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.label?.trim()) {
      setLabelError(true)
      return
    }
    setLabelError(false)
    onSubmit(form, dimensions)
    onClose()
  }

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
                <SelectTrigger className="bg-[#21262d] border-[#30363d] text-sm h-8 w-full">
                  <SelectValue />
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
                className="flex items-center justify-between gap-2 h-8 px-3 rounded-md bg-[#21262d] border border-[#30363d] text-sm hover:border-[#8b949e] transition-colors w-full"
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

            {/* Inline icon picker — full width, shown below the type+icon row */}
            {iconPickerOpen && (
              <div className="flex flex-col gap-2 p-2.5 rounded-md bg-[#0d1117] border border-[#30363d] col-span-2">
                <Input
                  value={iconSearch}
                  onChange={(e) => setIconSearch(e.target.value)}
                  placeholder="Search icons…"
                  className="bg-[#21262d] border-[#30363d] text-xs h-7"
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
                                className="flex items-center justify-center w-7 h-7 rounded transition-colors"
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
                className={`bg-[#21262d] text-sm h-8 ${labelError ? 'border-[#f85149] focus-visible:ring-[#f85149]' : 'border-[#30363d]'}`}
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
                className="bg-[#21262d] border-[#30363d] font-mono text-sm h-8"
              />
            </div>

            {/* IP */}
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">IP Address</Label>
              <Input
                value={form.ip ?? ''}
                onChange={(e) => set('ip', e.target.value)}
                placeholder="192.168.1.x"
                className="bg-[#21262d] border-[#30363d] font-mono text-sm h-8"
              />
            </div>

            {/* Check method */}
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">Check Method</Label>
              <Select value={form.check_method ?? 'ping'} onValueChange={(v) => set('check_method', v as CheckMethod)}>
                <SelectTrigger className="bg-[#21262d] border-[#30363d] text-sm h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#21262d] border-[#30363d]">
                  {CHECK_METHODS.map((m) => (
                    <SelectItem key={m} value={m} className="text-sm font-mono">{m}</SelectItem>
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
                className="bg-[#21262d] border-[#30363d] font-mono text-sm h-8"
              />
            </div>

            {/* Parent Proxmox (VM / LXC only) */}
            {CHILD_TYPES.includes(form.type as NodeType) && proxmoxNodes.length > 0 && (
              <div className="flex flex-col gap-1.5 col-span-2">
                <Label className="text-xs text-muted-foreground">Parent Proxmox</Label>
                <Select
                  value={form.parent_id ?? 'none'}
                  onValueChange={(v) => set('parent_id', v === 'none' ? undefined : v)}
                >
                  <SelectTrigger className="bg-[#21262d] border-[#30363d] text-sm h-8">
                    <SelectValue placeholder="None (standalone)" />
                  </SelectTrigger>
                  <SelectContent className="bg-[#21262d] border-[#30363d]">
                    <SelectItem value="none" className="text-sm">None (standalone)</SelectItem>
                    {proxmoxNodes.map((n) => (
                      <SelectItem key={n.id} value={n.id} className="text-sm">{n.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Container mode (proxmox only) */}
            {form.type === 'proxmox' && (
              <div className="flex items-center justify-between col-span-2 py-1">
                <div className="flex flex-col gap-0.5">
                  <Label className="text-xs text-muted-foreground">Container Mode</Label>
                  <span className="text-[10px] text-muted-foreground/60">Show VM/LXC nodes nested inside</span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={!!form.container_mode}
                  onClick={() => set('container_mode', !form.container_mode)}
                  className="relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus:outline-none"
                  style={{ background: form.container_mode ? '#ff6e00' : '#30363d' }}
                >
                  <span
                    className="pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform"
                    style={{ transform: form.container_mode ? 'translateX(16px)' : 'translateX(0)' }}
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
                        className="relative w-full h-7 rounded-md border cursor-pointer overflow-hidden transition-all"
                        style={{ borderColor: isCustom ? currentValue : '#30363d' }}
                        title={`${key.charAt(0).toUpperCase() + key.slice(1)}: ${currentValue}`}
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
                      <div className="flex flex-wrap justify-center gap-1 max-w-[82px]">
                        {COLOR_SWATCHES.slice(0, 6).map((swatch) => (
                          <button
                            key={`${key}-${swatch}`}
                            type="button"
                            aria-label={`${key} ${swatch}`}
                            onClick={() => set('custom_colors', { ...form.custom_colors, [key]: swatch })}
                            className="w-3.5 h-3.5 rounded-full border border-white/10"
                            style={{ background: swatch }}
                          />
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
              {!form.custom_colors && (
                <p className="text-[10px] text-muted-foreground/50">Using default colors for {NODE_TYPE_LABELS[form.type ?? 'generic']}. Click a swatch to customize.</p>
              )}
            </div>

            {form.type !== 'groupRect' && (
              <div className="flex flex-col gap-2 col-span-2">
                <Label className="text-xs text-muted-foreground">Node Dimensions</Label>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs text-muted-foreground">Width</Label>
                    <Input
                      type="number"
                      min={140}
                      step={10}
                      value={dimensions.width ?? ''}
                      onChange={(e) => setDimensions((current) => ({ ...current, width: e.target.value ? Number(e.target.value) : undefined }))}
                      placeholder="auto"
                      className="bg-[#21262d] border-[#30363d] font-mono text-sm h-8"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs text-muted-foreground">Height</Label>
                    <Input
                      type="number"
                      min={50}
                      step={10}
                      value={dimensions.height ?? ''}
                      onChange={(e) => setDimensions((current) => ({ ...current, height: e.target.value ? Number(e.target.value) : undefined }))}
                      placeholder="auto"
                      className="bg-[#21262d] border-[#30363d] font-mono text-sm h-8"
                    />
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground/50">
                  Leave empty to keep the default size. Resized nodes are saved automatically.
                </p>
              </div>
            )}

            {/* Hardware specs (hidden for groupRect) */}
            {form.type !== 'groupRect' && (
              <div className="flex flex-col gap-2 col-span-2">
                <div className="flex items-center justify-between w-full">
                  <button
                    type="button"
                    onClick={() => setHardwareOpen((o) => !o)}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <span className="font-medium">Hardware</span>
                    <ChevronDown size={12} style={{ transform: hardwareOpen ? 'rotate(180deg)' : undefined, transition: 'transform 0.15s' }} />
                  </button>
                  {hardwareOpen && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-muted-foreground/60">Show on node</span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={!!form.show_hardware}
                        onClick={() => set('show_hardware', !form.show_hardware)}
                        className="relative inline-flex h-4 w-7 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus:outline-none"
                        style={{ background: form.show_hardware ? '#00d4ff' : '#30363d' }}
                      >
                        <span
                          className="pointer-events-none inline-block h-3 w-3 rounded-full bg-white shadow-sm transition-transform"
                          style={{ transform: form.show_hardware ? 'translateX(12px)' : 'translateX(0)' }}
                        />
                      </button>
                    </div>
                  )}
                </div>
                {hardwareOpen && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1.5 col-span-2">
                      <Label className="text-xs text-muted-foreground">CPU Model</Label>
                      <Input
                        value={form.cpu_model ?? ''}
                        onChange={(e) => set('cpu_model', e.target.value || undefined)}
                        placeholder="e.g. Intel Xeon E5-2680"
                        className="bg-[#21262d] border-[#30363d] text-sm h-8"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label className="text-xs text-muted-foreground">CPU Cores</Label>
                      <Input
                        type="number"
                        min={1}
                        value={form.cpu_count ?? ''}
                        onChange={(e) => set('cpu_count', e.target.value ? parseInt(e.target.value, 10) : undefined)}
                        placeholder="e.g. 8"
                        className="bg-[#21262d] border-[#30363d] font-mono text-sm h-8"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label className="text-xs text-muted-foreground">RAM (GB)</Label>
                      <Input
                        type="number"
                        min={0}
                        step={0.5}
                        value={form.ram_gb ?? ''}
                        onChange={(e) => set('ram_gb', e.target.value ? parseFloat(e.target.value) : undefined)}
                        placeholder="e.g. 32"
                        className="bg-[#21262d] border-[#30363d] font-mono text-sm h-8"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5 col-span-2">
                      <Label className="text-xs text-muted-foreground">Disk (GB)</Label>
                      <Input
                        type="number"
                        min={0}
                        step={1}
                        value={form.disk_gb ?? ''}
                        onChange={(e) => set('disk_gb', e.target.value ? parseFloat(e.target.value) : undefined)}
                        placeholder="e.g. 500"
                        className="bg-[#21262d] border-[#30363d] font-mono text-sm h-8"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Bottom connection points (not for group containers) */}
            {form.type !== 'groupRect' && form.type !== 'group' && (
              <div className="flex flex-col gap-1.5 col-span-2">
                <Label className="text-xs text-muted-foreground">Bottom Connection Points</Label>
                <Select
                  value={String(form.bottom_handles ?? 1)}
                  onValueChange={(v) => set('bottom_handles', parseInt(v ?? '1', 10))}
                >
                  <SelectTrigger className="bg-[#21262d] border-[#30363d] text-sm h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-[#21262d] border-[#30363d]">
                    <SelectItem value="1" className="text-sm">1 — center</SelectItem>
                    <SelectItem value="2" className="text-sm">2 — left / right</SelectItem>
                    <SelectItem value="3" className="text-sm">3 — left / center / right</SelectItem>
                    <SelectItem value="4" className="text-sm">4 — evenly spaced</SelectItem>
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
                className="bg-[#21262d] border-[#30363d] text-sm h-8"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              className="bg-[#00d4ff] text-[#0d1117] hover:bg-[#00d4ff]/90"
            >
              {title === 'Add Node' ? 'Add' : 'Save'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

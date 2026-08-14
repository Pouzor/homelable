/**
 * Device Inventory detail — show *and* edit.
 *
 * The inventory row owns what a device is; a canvas node only owns how it is
 * drawn. So everything a user can curate on a node — properties, services,
 * notes, check method — is editable here too, through the same editors the
 * canvas uses (`PropertyList`, `ServiceModal`).
 *
 * Hardware specs are properties like any other: `cpu_*` / `ram_gb` / `disk_gb`
 * still carry what Proxmox and the YAML import record, but nothing draws them,
 * so they are not edited here — CPU / RAM / Disk are property suggestions.
 *
 * Layout mirrors `NodeModal`: one wide dialog, a header carrying identity and
 * badges, then three columns — identity / operations / curation — so a device
 * reads in one screen instead of a scrolling column of key-value pairs.
 */
import { useEffect, useState } from 'react'
import { Check, Copy, Layers, Pencil, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PropertyList } from '@/components/common/PropertyList'
import { ServiceModal } from './ServiceModal'
import { scanApi } from '@/api/client'
import { useThemeStore } from '@/stores/themeStore'
import { resolveNodeColors } from '@/utils/nodeColors'
import { NODE_TYPE_DEFAULT_ICONS } from '@/utils/nodeIcons'
import { isRackDevice, orderedSources, SOURCE_META } from '@/utils/deviceSources'
import { DEVICE_TYPE_GROUPS } from '@/utils/nodeTypeGroups'
import { formatRelative, formatTimestamp } from '@/utils/timeFormat'
import { serviceToForm, type ServiceFormData, type ServiceSubmitData } from '@/utils/serviceForm'
import { NODE_TYPE_LABELS, type CheckMethod, type InventoryEntry, type NodeProperty, type NodeType, type ServiceInfo } from '@/types'
import modalStyles from './modal-interactive.module.css'

// Home is `@/types` now — re-exported because most call sites import it here.
export type { InventoryEntry } from '@/types'

interface InventoryDeviceModalProps {
  device: InventoryEntry | null
  onClose: () => void
  onApprove: (device: InventoryEntry) => void
  onHide: (device: InventoryEntry) => void
  onIgnore: (device: InventoryEntry) => void
  /** Called with the saved row after an edit, so the list can refresh in place. */
  onSaved?: (device: InventoryEntry) => void
}

const CATEGORY_COLORS: Record<string, string> = {
  hypervisor: '#ff6e00',
  nas: '#39d353',
  automation: '#a855f7',
  containers: '#00d4ff',
  network: '#39d353',
  security: '#f85149',
  monitoring: '#e3b341',
  database: '#a855f7',
  web: '#00d4ff',
  media: '#ff6e00',
  iot: '#e3b341',
}

const CHECK_METHODS: CheckMethod[] = ['ping', 'http', 'https', 'tcp', 'ssh', 'prometheus', 'health', 'none']

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

/** Live reachability — not the pending/approved/hidden lifecycle. */
const LIVE_META: Record<string, { color: string; label: string }> = {
  online: { color: '#39d353', label: 'Online' },
  offline: { color: '#f85149', label: 'Offline' },
  pending: { color: '#e3b341', label: 'Checking' },
  unknown: { color: '#8b949e', label: 'Unknown' },
}

const INPUT = 'bg-[#21262d] border-[#30363d] text-sm h-8'

function categoryColor(category: string | null | undefined) {
  if (!category) return '#8b949e'
  return CATEGORY_COLORS[category.toLowerCase()] ?? '#8b949e'
}

/** A section card: heading bar, optional action, body. */
function Section({
  title,
  action,
  children,
}: {
  title: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="rounded-lg border border-[#30363d] bg-[#161b22] overflow-hidden">
      <header className="flex items-center justify-between gap-2 px-3 py-2 border-b border-[#30363d] bg-[#0d1117]/50">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</span>
        {action}
      </header>
      <div className="p-3">{children}</div>
    </section>
  )
}

function Chip({ color, children, title }: { color: string; children: React.ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className="text-[9px] font-mono px-1.5 py-0.5 rounded uppercase tracking-wider"
      style={{ background: `${color}22`, color }}
    >
      {children}
    </span>
  )
}

/** Copies a technical value; the row keeps its own confirmation state. */
function CopyButton({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    // `clipboard` is absent outside a secure context (and in jsdom), so the
    // promise itself is optional, not just the API.
    const written = navigator.clipboard?.writeText(value)
    if (!written) return
    written
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1200)
      })
      .catch(() => toast.error('Could not copy'))
  }
  return (
    <button
      onClick={copy}
      aria-label={`Copy ${label}`}
      className="ml-auto shrink-0 text-muted-foreground/50 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-[#00d4ff] transition-opacity cursor-pointer"
    >
      {copied ? <Check size={11} className="text-[#39d353]" /> : <Copy size={11} />}
    </button>
  )
}

function InfoRow({ label, value, copyable }: { label: string; value: string; copyable?: boolean }) {
  return (
    <div className="group flex items-baseline gap-3 py-1 border-b border-[#30363d]/40 last:border-b-0 text-xs">
      <span className="w-20 shrink-0 text-[11px] text-muted-foreground">{label}</span>
      <span className="min-w-0 font-mono text-foreground break-all">{value}</span>
      {copyable && <CopyButton label={label} value={value} />}
    </div>
  )
}

/** A timestamp reads relative, with the exact value on hover. */
function TimeRow({ label, iso }: { label: string; iso: string }) {
  return (
    <div className="flex items-baseline gap-3 py-1 border-b border-[#30363d]/40 last:border-b-0 text-xs" title={formatTimestamp(iso)}>
      <span className="w-20 shrink-0 text-[11px] text-muted-foreground">{label}</span>
      <span className="font-mono text-foreground/80">{formatRelative(iso)}</span>
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted-foreground italic">{children}</p>
}

function Field({ label, hint, children, className = '' }: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`flex flex-col gap-1.5 min-w-0 ${className}`}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
      {hint && <span className="text-[10px] text-muted-foreground/50">{hint}</span>}
    </div>
  )
}

/** The editable subset of an inventory row, as strings for the form inputs. */
interface EditForm {
  label: string
  type: string
  hostname: string
  ip: string
  mac: string
  os: string
  vendor: string
  model: string
  friendly_name: string
  device_subtype: string
  notes: string
  cpu_count: string
  cpu_model: string
  ram_gb: string
  disk_gb: string
  show_hardware: boolean
  check_method: string
  check_target: string
}

function toForm(d: InventoryEntry): EditForm {
  return {
    label: d.label ?? '',
    // Falls back to the discovery guess, so a first edit adopts it rather than
    // silently clearing what the scanner suggested.
    type: d.type ?? d.suggested_type ?? '',
    hostname: d.hostname ?? '',
    ip: d.ip ?? '',
    mac: d.mac ?? '',
    os: d.os ?? '',
    vendor: d.vendor ?? '',
    model: d.model ?? '',
    friendly_name: d.friendly_name ?? '',
    device_subtype: d.device_subtype ?? '',
    notes: d.notes ?? '',
    cpu_count: d.cpu_count != null ? String(d.cpu_count) : '',
    cpu_model: d.cpu_model ?? '',
    ram_gb: d.ram_gb != null ? String(d.ram_gb) : '',
    disk_gb: d.disk_gb != null ? String(d.disk_gb) : '',
    show_hardware: d.show_hardware ?? false,
    check_method: d.check_method ?? '',
    check_target: d.check_target ?? '',
  }
}

const nullable = (v: string) => (v.trim() === '' ? null : v.trim())
const numeric = (v: string) => (v.trim() === '' ? null : Number(v))

export function InventoryDeviceModal({ device, onClose, onApprove, onHide, onIgnore, onSaved }: InventoryDeviceModalProps) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<EditForm>(() => (device ? toForm(device) : toForm({} as InventoryEntry)))
  const [properties, setProperties] = useState<NodeProperty[]>(device?.properties ?? [])
  const [services, setServices] = useState<ServiceInfo[]>(device?.services ?? [])
  const [svcModal, setSvcModal] = useState<{ index: number | null; form?: ServiceFormData } | null>(null)
  const [saving, setSaving] = useState(false)
  const activeTheme = useThemeStore((s) => s.activeTheme)

  // Reset the form whenever the modal is pointed at another device — the
  // component stays mounted across card clicks in the inventory grid.
  useEffect(() => {
    if (!device) return
    setForm(toForm(device))
    setProperties(device.properties ?? [])
    setServices(device.services ?? [])
    setEditing(false)
    setSvcModal(null)
  }, [device])

  if (!device) return null

  const resolvedType = (device.type ?? device.suggested_type ?? 'generic') as NodeType
  const TypeIcon = NODE_TYPE_DEFAULT_ICONS[resolvedType] ?? NODE_TYPE_DEFAULT_ICONS.generic
  // Same accent the node wears on the canvas, so a device looks like itself.
  const roleColor = resolveNodeColors({ type: resolvedType, custom_colors: undefined }, activeTheme).border
  const isZigbee = device.discovery_source === 'zigbee'
  const rackOnly = isRackDevice(device)
  const sources = orderedSources(device)
  const live = LIVE_META[device.status_live ?? 'unknown'] ?? LIVE_META.unknown
  const titleLabel = device.label ?? device.friendly_name ?? device.hostname ?? device.ip ?? device.ieee_address ?? 'Pending device'

  const set = <K extends keyof EditForm>(key: K, value: EditForm[K]) => setForm((f) => ({ ...f, [key]: value }))

  const handleApprove = () => { onApprove(device) }
  const handleHide = () => { onHide(device); onClose() }
  const handleIgnore = () => { onIgnore(device); onClose() }

  const handleCancel = () => {
    setEditing(false)
    setForm(toForm(device))
    setProperties(device.properties ?? [])
    setServices(device.services ?? [])
  }

  const handleSubmitService = (data: ServiceSubmitData) => {
    const svc: ServiceInfo = {
      ...(data.port != null ? { port: data.port } : {}),
      protocol: data.protocol,
      service_name: data.service_name,
      ...(data.path ? { path: data.path } : {}),
      ...(data.host ? { host: data.host } : {}),
      ...(data.icon ? { icon: data.icon } : {}),
    }
    setServices((prev) =>
      svcModal?.index == null ? [...prev, svc] : prev.map((s, i) => (i === svcModal.index ? { ...s, ...svc } : s))
    )
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await scanApi.updatePending(device.id, {
        label: nullable(form.label),
        type: nullable(form.type),
        hostname: nullable(form.hostname),
        ip: nullable(form.ip),
        mac: nullable(form.mac),
        os: nullable(form.os),
        vendor: nullable(form.vendor),
        model: nullable(form.model),
        friendly_name: nullable(form.friendly_name),
        device_subtype: nullable(form.device_subtype),
        notes: nullable(form.notes),
        // Hardware is curated as properties, like every other spec — these five
        // are no longer editable here. They still carry Proxmox and YAML data,
        // so they go back untouched rather than being silently cleared.
        cpu_count: numeric(form.cpu_count),
        cpu_model: nullable(form.cpu_model),
        ram_gb: numeric(form.ram_gb),
        disk_gb: numeric(form.disk_gb),
        show_hardware: form.show_hardware,
        check_method: nullable(form.check_method) as CheckMethod | null,
        check_target: nullable(form.check_target),
        properties,
        services,
      })
      toast.success('Device updated')
      setEditing(false)
      onSaved?.(res.data)
    } catch {
      toast.error('Could not update device')
    } finally {
      setSaving(false)
    }
  }

  const timestamps: { label: string; iso: string }[] = []
  if (device.discovered_at) timestamps.push({ label: 'Discovered', iso: device.discovered_at })
  if (device.node_created_at) timestamps.push({ label: 'On canvas', iso: device.node_created_at })
  if (device.node_last_scan) timestamps.push({ label: 'Last scan', iso: device.node_last_scan })
  if (device.node_last_seen) timestamps.push({ label: 'Last seen', iso: device.node_last_seen })
  if (device.node_last_modified) timestamps.push({ label: 'Modified', iso: device.node_last_modified })

  return (
    <Dialog open={!!device} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="!max-w-none w-[min(1180px,95vw)] max-h-[90vh] p-0 gap-0 flex flex-col overflow-hidden bg-[#0d1117] border-[#30363d] text-foreground">
        {/* ── Header: who this device is, at a glance ── */}
        <DialogHeader className="shrink-0 px-5 py-4 border-b border-[#30363d] bg-[#161b22]">
          <div className="flex items-start gap-3 pr-10">
            <div
              className="w-11 h-11 shrink-0 rounded-lg border flex items-center justify-center"
              style={{ background: `${roleColor}18`, borderColor: `${roleColor}55`, color: roleColor }}
            >
              <TypeIcon size={20} />
            </div>
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-base font-semibold leading-tight break-all">{titleLabel}</DialogTitle>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {sources.map((s) => (
                  <Chip key={s} color={SOURCE_META[s].color}>{SOURCE_META[s].label}</Chip>
                ))}
                {(device.type ?? device.suggested_type) && (
                  <Chip color={roleColor}>{NODE_TYPE_LABELS[resolvedType] ?? resolvedType}</Chip>
                )}
                <span
                  className="flex items-center gap-1 text-[9px] font-mono px-1.5 py-0.5 rounded uppercase tracking-wider"
                  style={{ background: `${live.color}22`, color: live.color }}
                  title="Live reachability"
                >
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: live.color }} />
                  {live.label}
                </span>
                {(device.canvas_count ?? 0) > 0 && (
                  <span
                    className="flex items-center gap-1 text-[9px] font-mono px-1.5 py-0.5 rounded uppercase tracking-wider bg-[#00d4ff]/15 text-[#00d4ff]"
                    title={`Drawn on ${device.canvas_count} canvas${device.canvas_count !== 1 ? 'es' : ''}`}
                  >
                    <Layers size={10} />
                    {device.canvas_count}
                  </span>
                )}
                {device.status === 'hidden' && <Chip color="#8b949e">Hidden</Chip>}
                {device.lqi != null && <Chip color="#8b949e">LQI {device.lqi}</Chip>}
              </div>
            </div>
            {!editing && (
              <Button
                size="sm"
                variant="ghost"
                className={`shrink-0 gap-1.5 text-[#00d4ff] hover:text-[#00d4ff] hover:bg-[#00d4ff]/10 ${modalStyles['modal-interactive']}`}
                onClick={() => setEditing(true)}
              >
                <Pencil size={13} /> Edit
              </Button>
            )}
          </div>
        </DialogHeader>

        {/* ── Body: three columns — identity / operations / curation ── */}
        <div className="flex-1 min-h-0 overflow-y-auto p-5">
          {editing ? (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
              <div className="flex flex-col gap-4 min-w-0">
                <Section title="Identity">
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Name" className="col-span-2">
                      <Input value={form.label} onChange={(e) => set('label', e.target.value)} placeholder="Display name" className={INPUT} />
                    </Field>
                    <Field label="Type" className="col-span-2">
                      <Select value={form.type || undefined} onValueChange={(v) => set('type', (v as string | null) ?? '')}>
                        <SelectTrigger className={`${INPUT} w-full cursor-pointer ${modalStyles['modal-interactive']}`} aria-label="Device type selector">
                          <SelectValue placeholder="Pick a type" />
                        </SelectTrigger>
                        <SelectContent className="bg-[#21262d] border-[#30363d]">
                          {DEVICE_TYPE_GROUPS.map((group, i) => (
                            <SelectGroup key={group.label}>
                              {i > 0 && <SelectSeparator className="bg-[#30363d]" />}
                              <SelectLabel className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 px-2 py-1">
                                {group.label}
                              </SelectLabel>
                              {group.types.map((t) => (
                                <SelectItem key={t} value={t} className="text-sm pl-4">
                                  {NODE_TYPE_LABELS[t] ?? t}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="Hostname">
                      <Input value={form.hostname} onChange={(e) => set('hostname', e.target.value)} placeholder="server.lan" className={`${INPUT} font-mono`} />
                    </Field>
                    <Field label="IP" hint="comma-separated">
                      <Input value={form.ip} onChange={(e) => set('ip', e.target.value)} placeholder="10.0.0.5, 10.0.1.5" className={`${INPUT} font-mono`} />
                    </Field>
                    <Field label="MAC">
                      <Input value={form.mac} onChange={(e) => set('mac', e.target.value)} placeholder="aa:bb:cc:dd:ee:ff" className={`${INPUT} font-mono`} />
                    </Field>
                    <Field label="OS">
                      <Input value={form.os} onChange={(e) => set('os', e.target.value)} placeholder="Debian 12" className={INPUT} />
                    </Field>
                  </div>
                </Section>

                <Section title="Make & model">
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Vendor">
                      <Input value={form.vendor} onChange={(e) => set('vendor', e.target.value)} className={INPUT} />
                    </Field>
                    <Field label="Model">
                      <Input value={form.model} onChange={(e) => set('model', e.target.value)} className={INPUT} />
                    </Field>
                    <Field label="Friendly name">
                      <Input value={form.friendly_name} onChange={(e) => set('friendly_name', e.target.value)} className={INPUT} />
                    </Field>
                    <Field label="Role">
                      <Input value={form.device_subtype} onChange={(e) => set('device_subtype', e.target.value)} placeholder="e.g. router" className={INPUT} />
                    </Field>
                  </div>
                </Section>
              </div>

              <div className="flex flex-col gap-4 min-w-0">
                <Section title="Monitoring">
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Check method">
                      <Select value={form.check_method || undefined} onValueChange={(v) => set('check_method', (v as string | null) ?? '')}>
                        <SelectTrigger className={`${INPUT} w-full cursor-pointer ${modalStyles['modal-interactive']}`} aria-label="Check method selector">
                          <SelectValue placeholder="None" />
                        </SelectTrigger>
                        <SelectContent className="bg-[#21262d] border-[#30363d]">
                          {CHECK_METHODS.map((m) => (
                            <SelectItem key={m} value={m} className="text-sm">{CHECK_METHOD_LABELS[m]}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="Check target">
                      <Input value={form.check_target} onChange={(e) => set('check_target', e.target.value)} placeholder="host:port or URL" className={`${INPUT} font-mono`} />
                    </Field>
                  </div>
                </Section>

                <Section title="Notes">
                  <Textarea
                    value={form.notes}
                    onChange={(e) => set('notes', e.target.value)}
                    rows={6}
                    placeholder="Anything worth remembering about this device."
                    className="bg-[#21262d] border-[#30363d] text-sm"
                  />
                </Section>
              </div>

              <div className="flex flex-col gap-4 min-w-0">
                {/* Same editors as the canvas — one implementation, one behaviour. */}
                <section className="rounded-lg border border-[#30363d] bg-[#161b22] overflow-hidden">
                  <PropertyList
                    properties={properties}
                    onChange={setProperties}
                    visibleLabel="Show on node"
                    // Hardware is a property like any other; these are the keys
                    // the Proxmox import and the YAML import already mint.
                    suggestions={['CPU Model', 'CPU Cores', 'RAM', 'Disk']}
                  />
                </section>

                <Section
                  title={`Services${services.length > 0 ? ` (${services.length})` : ''}`}
                  action={
                    <button
                      onClick={() => setSvcModal({ index: null })}
                      className="flex items-center gap-1 text-[10px] text-[#00d4ff] hover:text-[#00d4ff]/80 transition-colors cursor-pointer"
                    >
                      <Plus size={10} /> Add
                    </button>
                  }
                >
                  {services.length === 0 ? (
                    <Empty>No services — click Add to register one.</Empty>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      {services.map((svc, i) => (
                        <div key={`${svc.port ?? 'host'}-${svc.protocol}-${i}`} className="group flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-[#21262d] border border-[#30363d] text-xs">
                          <span className="font-mono text-[#00d4ff] w-10 shrink-0">{svc.port ?? '—'}</span>
                          <span className="text-muted-foreground w-8 shrink-0">{svc.protocol}</span>
                          <span className="text-foreground truncate">{svc.service_name}</span>
                          <div className="ml-auto flex items-center gap-1.5 shrink-0">
                            <button
                              onClick={() => setSvcModal({ index: i, form: serviceToForm(svc) })}
                              title="Edit service"
                              className="text-[#8b949e] hover:text-[#00d4ff] cursor-pointer"
                            >
                              <Pencil size={11} />
                            </button>
                            <button
                              onClick={() => setServices((prev) => prev.filter((_, j) => j !== i))}
                              title="Remove service"
                              className="text-[#8b949e] hover:text-[#f85149] cursor-pointer"
                            >
                              <X size={11} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Section>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
              <div className="flex flex-col gap-4 min-w-0">
                <Section title="Identity">
                  <div className="flex flex-col">
                    {device.ip && <InfoRow label="IP" value={device.ip} copyable />}
                    {device.hostname && <InfoRow label="Hostname" value={device.hostname} copyable />}
                    {device.mac && <InfoRow label="MAC" value={device.mac} copyable />}
                    {device.ieee_address && <InfoRow label="IEEE" value={device.ieee_address} copyable />}
                    {device.os && <InfoRow label="OS" value={device.os} />}
                    {(device.type ?? device.suggested_type) && (
                      <InfoRow label="Type" value={(device.type ?? device.suggested_type) as string} />
                    )}
                    {device.friendly_name && device.friendly_name !== device.hostname && (
                      <InfoRow label="Name" value={device.friendly_name} />
                    )}
                    {device.vendor && <InfoRow label="Vendor" value={device.vendor} />}
                    {device.model && <InfoRow label="Model" value={device.model} />}
                    {device.device_subtype && <InfoRow label="Role" value={device.device_subtype} />}
                    {device.lqi != null && <InfoRow label="LQI" value={String(device.lqi)} />}
                    {!device.ip && !device.hostname && !device.mac && !device.ieee_address && (
                      <Empty>Nothing identifying recorded yet.</Empty>
                    )}
                  </div>
                </Section>

              </div>

              <div className="flex flex-col gap-4 min-w-0">
                <Section title="Monitoring">
                  <div className="flex flex-col">
                    {device.check_method ? (
                      <InfoRow
                        label="Check"
                        value={device.check_target ? `${device.check_method} → ${device.check_target}` : device.check_method}
                      />
                    ) : (
                      <Empty>Not monitored — pick a check method from Edit.</Empty>
                    )}
                    {device.response_time_ms != null && <InfoRow label="Response" value={`${device.response_time_ms} ms`} />}
                    {device.discovery_source && <InfoRow label="Source" value={device.discovery_source.toUpperCase()} />}
                    {device.canvas_count != null && device.canvas_count > 0 && (
                      <InfoRow label="Canvases" value={String(device.canvas_count)} />
                    )}
                  </div>
                </Section>

                <Section title="Activity">
                  <div className="flex flex-col">
                    {timestamps.length === 0 ? (
                      <Empty>No activity recorded.</Empty>
                    ) : (
                      timestamps.map((t) => <TimeRow key={t.label} label={t.label} iso={t.iso} />)
                    )}
                  </div>
                </Section>

                <Section title="Notes">
                  {device.notes ? (
                    <p className="text-xs text-foreground/80 whitespace-pre-wrap">{device.notes}</p>
                  ) : (
                    <Empty>No notes.</Empty>
                  )}
                </Section>
              </div>

              <div className="flex flex-col gap-4 min-w-0">
                <Section title={`Properties${device.properties && device.properties.length > 0 ? ` (${device.properties.length})` : ''}`}>
                  {device.properties && device.properties.length > 0 ? (
                    <div className="flex flex-col gap-1.5">
                      {device.properties.map((prop, i) => (
                        <div key={`${prop.key}-${i}`} className="flex items-baseline gap-2 px-2.5 py-1.5 rounded-md bg-[#21262d] border border-[#30363d] text-xs">
                          <span className="text-muted-foreground shrink-0">{prop.key}</span>
                          <span className="ml-auto font-mono text-foreground break-all text-right">{prop.value}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <Empty>No properties.</Empty>
                  )}
                </Section>

                {/* Zigbee devices have no IP services — the section would always be empty. */}
                {!isZigbee && (
                  <Section title={`Services found (${device.services.length})`}>
                    {device.services.length === 0 ? (
                      <Empty>No services detected</Empty>
                    ) : (
                      <div className="flex flex-col gap-1.5 max-h-72 overflow-y-auto">
                        {device.services.map((svc, i) => (
                          <div
                            key={i}
                            className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-[#21262d] border border-[#30363d] text-xs"
                          >
                            <span
                              className="w-1.5 h-1.5 rounded-full shrink-0"
                              style={{ backgroundColor: categoryColor(svc.category) }}
                            />
                            <span className="font-mono text-[#00d4ff] w-10 shrink-0">{svc.port}</span>
                            <span className="text-muted-foreground w-8 shrink-0">{svc.protocol}</span>
                            <span className="text-foreground truncate">{svc.service_name}</span>
                            {svc.category && (
                              <span className="ml-auto text-[10px] shrink-0" style={{ color: categoryColor(svc.category) }}>
                                {svc.category}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </Section>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── Footer: lifecycle in view, form controls in edit ── */}
        <div className="shrink-0 flex items-center justify-between gap-3 px-5 py-3 border-t border-[#30363d] bg-[#161b22]">
          <p className="text-[11px] text-muted-foreground/70 min-w-0 truncate">
            {editing
              ? 'These facts belong to the device — every canvas drawing it follows.'
              : rackOnly
                ? 'Rack gear — mounted from a rack canvas, never placed on a logical one.'
                : 'One device, one row. Editing here updates every canvas drawing it.'}
          </p>
          {editing ? (
            <div className="flex items-center gap-2 shrink-0">
              <Button size="sm" variant="ghost" onClick={handleCancel} className="text-muted-foreground hover:text-foreground">
                Cancel
              </Button>
              <Button
                size="sm"
                className="bg-[#00d4ff] text-[#0d1117] hover:bg-[#00d4ff]/90 min-w-20"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2 shrink-0">
              <Button
                size="sm"
                variant="ghost"
                className="text-muted-foreground hover:text-foreground hover:bg-[#30363d]"
                onClick={handleHide}
              >
                Hide
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-[#f85149] hover:text-[#f85149] hover:bg-[#f85149]/10"
                onClick={handleIgnore}
              >
                Delete
              </Button>
              {/* Rack gear is mounted from a rack canvas, never approved onto a
                  logical one — so it gets no Approve button at all. */}
              {!rackOnly && (
                <Button
                  size="sm"
                  className="bg-[#39d353]/15 text-[#39d353] hover:bg-[#39d353]/25 border border-[#39d353]/30"
                  onClick={handleApprove}
                >
                  Approve
                </Button>
              )}
            </div>
          )}
        </div>

        {svcModal && (
          <ServiceModal
            key={`svc-${svcModal.index ?? 'new'}`}
            open
            onClose={() => setSvcModal(null)}
            onSubmit={handleSubmitService}
            initial={svcModal.form}
            title={svcModal.index === null ? 'Add Service' : 'Edit Service'}
            confirmLabel={svcModal.index === null ? 'Add' : 'Save'}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

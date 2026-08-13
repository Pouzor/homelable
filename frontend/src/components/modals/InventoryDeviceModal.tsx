/**
 * Device Inventory detail — show *and* edit.
 *
 * The inventory row owns what a device is; a canvas node only owns how it is
 * drawn. So everything a user can curate on a node — properties, services,
 * notes, hardware specs, check method — is editable here too, through the same
 * editors the canvas uses (`PropertyList`, `ServiceModal`).
 */
import { useEffect, useState } from 'react'
import { Globe, Router, Server, Layers, Box, Container, HardDrive, Cpu, Wifi, Circle, Network, Pencil, Plus, X } from 'lucide-react'
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
import { isRackDevice } from '@/utils/deviceSources'
import { DEVICE_TYPE_GROUPS } from '@/utils/nodeTypeGroups'
import { serviceToForm, type ServiceFormData, type ServiceSubmitData } from '@/utils/serviceForm'
import { NODE_TYPE_LABELS, type CheckMethod, type InventoryEntry, type NodeProperty, type ServiceInfo } from '@/types'

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

const TYPE_ICONS: Record<string, React.ElementType> = {
  isp: Globe,
  router: Router,
  server: Server,
  proxmox: Layers,
  vm: Box,
  lxc: Container,
  nas: HardDrive,
  iot: Cpu,
  ap: Wifi,
  switch: Network,
  generic: Circle,
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

function categoryColor(category: string | null | undefined) {
  if (!category) return '#8b949e'
  return CATEGORY_COLORS[category.toLowerCase()] ?? '#8b949e'
}

/** Server datetimes come back naive-UTC on legacy rows; pin the zone before parsing. */
function formatDate(value: string | null | undefined): string | null {
  if (!value) return null
  return new Date(value.endsWith('Z') ? value : value + 'Z').toLocaleString()
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2 text-xs">
      <span className="text-muted-foreground w-20 shrink-0">{label}</span>
      <span className="font-mono text-foreground break-all">{value}</span>
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

  const TypeIcon = TYPE_ICONS[device.type ?? device.suggested_type ?? 'generic'] ?? Circle
  const isZigbee = device.discovery_source === 'zigbee'
  const rackOnly = isRackDevice(device)
  const titleLabel = device.label ?? device.friendly_name ?? device.hostname ?? device.ip ?? device.ieee_address ?? 'Pending device'

  const set = <K extends keyof EditForm>(key: K, value: EditForm[K]) => setForm((f) => ({ ...f, [key]: value }))

  const handleApprove = () => { onApprove(device) }
  const handleHide = () => { onHide(device); onClose() }
  const handleIgnore = () => { onIgnore(device); onClose() }

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

  const discoveredAt = formatDate(device.discovered_at)
  const hardware = [
    device.cpu_count != null ? `${device.cpu_count} vCPU` : null,
    device.cpu_model,
    device.ram_gb != null ? `${device.ram_gb} GB RAM` : null,
    device.disk_gb != null ? `${device.disk_gb} GB disk` : null,
  ].filter(Boolean).join(' · ')

  return (
    <Dialog open={!!device} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={`bg-[#161b22] border-[#30363d] text-foreground ${editing ? 'max-w-lg' : 'max-w-sm'} max-h-[85vh] overflow-y-auto`}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
            <TypeIcon size={15} className="text-[#00d4ff] shrink-0" />
            {titleLabel}
            {isZigbee && (
              <span className="ml-1 text-[9px] font-mono uppercase px-1 py-0.5 rounded bg-[#00d4ff]/15 text-[#00d4ff] border border-[#00d4ff]/30">
                Zigbee
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        {editing ? (
          <div className="flex flex-col gap-3 mt-1">
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <Label className="text-[10px] text-muted-foreground">Name</Label>
                <Input value={form.label} onChange={(e) => set('label', e.target.value)} placeholder="Display name" className="bg-[#21262d] border-[#30363d] text-xs h-7" />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-[10px] text-muted-foreground">Type</Label>
                <Select value={form.type || undefined} onValueChange={(v) => set('type', (v as string | null) ?? '')}>
                  <SelectTrigger className="bg-[#21262d] border-[#30363d] text-xs h-7">
                    <SelectValue placeholder="Pick a type" />
                  </SelectTrigger>
                  <SelectContent>
                    {DEVICE_TYPE_GROUPS.map((group, i) => (
                      <SelectGroup key={group.label}>
                        {i > 0 && <SelectSeparator />}
                        <SelectLabel className="text-[10px]">{group.label}</SelectLabel>
                        {group.types.map((t) => (
                          <SelectItem key={t} value={t} className="text-xs">
                            {NODE_TYPE_LABELS[t] ?? t}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-[10px] text-muted-foreground">Hostname</Label>
                <Input value={form.hostname} onChange={(e) => set('hostname', e.target.value)} className="bg-[#21262d] border-[#30363d] text-xs h-7 font-mono" />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-[10px] text-muted-foreground">IP</Label>
                <Input value={form.ip} onChange={(e) => set('ip', e.target.value)} placeholder="10.0.0.5, 10.0.1.5" className="bg-[#21262d] border-[#30363d] text-xs h-7 font-mono" />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-[10px] text-muted-foreground">MAC</Label>
                <Input value={form.mac} onChange={(e) => set('mac', e.target.value)} className="bg-[#21262d] border-[#30363d] text-xs h-7 font-mono" />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-[10px] text-muted-foreground">OS</Label>
                <Input value={form.os} onChange={(e) => set('os', e.target.value)} className="bg-[#21262d] border-[#30363d] text-xs h-7" />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-[10px] text-muted-foreground">Vendor</Label>
                <Input value={form.vendor} onChange={(e) => set('vendor', e.target.value)} className="bg-[#21262d] border-[#30363d] text-xs h-7" />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-[10px] text-muted-foreground">Model</Label>
                <Input value={form.model} onChange={(e) => set('model', e.target.value)} className="bg-[#21262d] border-[#30363d] text-xs h-7" />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-[10px] text-muted-foreground">Check method</Label>
                <Select value={form.check_method || undefined} onValueChange={(v) => set('check_method', (v as string | null) ?? '')}>
                  <SelectTrigger className="bg-[#21262d] border-[#30363d] text-xs h-7">
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    {CHECK_METHODS.map((m) => (
                      <SelectItem key={m} value={m} className="text-xs">{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-[10px] text-muted-foreground">Check target</Label>
                <Input value={form.check_target} onChange={(e) => set('check_target', e.target.value)} placeholder="host:port or URL" className="bg-[#21262d] border-[#30363d] text-xs h-7 font-mono" />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-[10px] text-muted-foreground">vCPU</Label>
                <Input value={form.cpu_count} onChange={(e) => set('cpu_count', e.target.value.replace(/\D/g, ''))} className="bg-[#21262d] border-[#30363d] text-xs h-7 font-mono" />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-[10px] text-muted-foreground">CPU model</Label>
                <Input value={form.cpu_model} onChange={(e) => set('cpu_model', e.target.value)} className="bg-[#21262d] border-[#30363d] text-xs h-7" />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-[10px] text-muted-foreground">RAM (GB)</Label>
                <Input value={form.ram_gb} onChange={(e) => set('ram_gb', e.target.value.replace(/[^\d.]/g, ''))} className="bg-[#21262d] border-[#30363d] text-xs h-7 font-mono" />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-[10px] text-muted-foreground">Disk (GB)</Label>
                <Input value={form.disk_gb} onChange={(e) => set('disk_gb', e.target.value.replace(/[^\d.]/g, ''))} className="bg-[#21262d] border-[#30363d] text-xs h-7 font-mono" />
              </div>
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.show_hardware}
                onChange={(e) => set('show_hardware', e.target.checked)}
                className="accent-[#00d4ff] w-3 h-3"
              />
              <span className="text-[10px] text-muted-foreground">Show hardware specs on the node</span>
            </label>

            <div className="flex flex-col gap-1">
              <Label className="text-[10px] text-muted-foreground">Notes</Label>
              <Textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={3} className="bg-[#21262d] border-[#30363d] text-xs" />
            </div>

            {/* Same editors as the canvas — one implementation, one behaviour. */}
            <div className="-mx-6">
              <PropertyList properties={properties} onChange={setProperties} visibleLabel="Show on node" />
            </div>

            <div className="border-t border-border pt-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted-foreground">Services{services.length > 0 ? ` (${services.length})` : ''}</span>
                <button onClick={() => setSvcModal({ index: null })} className="flex items-center gap-1 text-[10px] text-[#00d4ff] hover:text-[#00d4ff]/80 transition-colors cursor-pointer">
                  <Plus size={10} /> Add
                </button>
              </div>
              {services.length === 0 ? (
                <p className="text-[10px] text-muted-foreground/50">No services — click Add to register one.</p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {services.map((svc, i) => (
                    <div key={`${svc.port ?? 'host'}-${svc.protocol}-${i}`} className="group flex items-center gap-2 px-2 py-1.5 rounded bg-[#21262d] border border-[#30363d] text-xs">
                      <span className="font-mono text-[#00d4ff] w-10 shrink-0">{svc.port ?? '—'}</span>
                      <span className="text-muted-foreground w-7 shrink-0">{svc.protocol}</span>
                      <span className="text-foreground truncate">{svc.service_name}</span>
                      <div className="ml-auto flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => setSvcModal({ index: i, form: serviceToForm(svc) })}
                          title="Edit service"
                          className="text-[#8b949e] hover:text-[#00d4ff]"
                        >
                          <Pencil size={10} />
                        </button>
                        <button
                          onClick={() => setServices((prev) => prev.filter((_, j) => j !== i))}
                          title="Remove service"
                          className="text-[#8b949e] hover:text-[#f85149]"
                        >
                          <X size={10} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex gap-2 pt-1">
              <Button
                size="sm"
                className="flex-1 bg-[#00d4ff] text-[#0d1117] hover:bg-[#00d4ff]/90"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? 'Saving…' : 'Save'}
              </Button>
              <Button size="sm" variant="ghost" className="flex-1" onClick={() => { setEditing(false); setForm(toForm(device)); setProperties(device.properties ?? []); setServices(device.services ?? []) }}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
        <div className="flex flex-col gap-4 mt-1">
          {/* Device info */}
          <div className="flex flex-col gap-1.5 p-3 rounded-md bg-[#21262d] border border-[#30363d]">
            {device.ip && <InfoRow label="IP" value={device.ip} />}
            {device.hostname && <InfoRow label="Hostname" value={device.hostname} />}
            {device.mac && <InfoRow label="MAC" value={device.mac} />}
            {device.os && <InfoRow label="OS" value={device.os} />}
            {device.ieee_address && <InfoRow label="IEEE" value={device.ieee_address} />}
            {device.friendly_name && device.friendly_name !== device.hostname && (
              <InfoRow label="Name" value={device.friendly_name} />
            )}
            {device.vendor && <InfoRow label="Vendor" value={device.vendor} />}
            {device.model && <InfoRow label="Model" value={device.model} />}
            {device.device_subtype && <InfoRow label="Role" value={device.device_subtype} />}
            {device.lqi != null && <InfoRow label="LQI" value={String(device.lqi)} />}
            {(device.type ?? device.suggested_type) && (
              <InfoRow label="Type" value={(device.type ?? device.suggested_type) as string} />
            )}
            {hardware && <InfoRow label="Hardware" value={hardware} />}
            {device.check_method && (
              <InfoRow label="Check" value={device.check_target ? `${device.check_method} → ${device.check_target}` : device.check_method} />
            )}
            {device.status_live && device.status_live !== 'unknown' && (
              <InfoRow label="Live" value={device.status_live} />
            )}
            {device.discovery_source && (
              <InfoRow label="Source" value={device.discovery_source.toUpperCase()} />
            )}
            {device.canvas_count != null && device.canvas_count > 0 && (
              <InfoRow label="Canvases" value={String(device.canvas_count)} />
            )}
            {discoveredAt && <InfoRow label="Discovered" value={discoveredAt} />}
            {formatDate(device.node_last_scan) && <InfoRow label="Last scan" value={formatDate(device.node_last_scan) as string} />}
            {formatDate(device.node_last_seen) && <InfoRow label="Last seen" value={formatDate(device.node_last_seen) as string} />}
            {formatDate(device.node_last_modified) && <InfoRow label="Modified" value={formatDate(device.node_last_modified) as string} />}
          </div>

          {/* Properties */}
          {device.properties && device.properties.length > 0 && (
            <div>
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                Properties ({device.properties.length})
              </p>
              <div className="flex flex-col gap-1">
                {device.properties.map((prop, i) => (
                  <div key={`${prop.key}-${i}`} className="flex items-baseline gap-2 px-2.5 py-1.5 rounded bg-[#21262d] border border-[#30363d] text-xs">
                    <span className="text-muted-foreground shrink-0">{prop.key}</span>
                    <span className="font-mono text-foreground break-all">{prop.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Notes */}
          {device.notes && (
            <div>
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">Notes</p>
              <p className="text-xs text-foreground/80 whitespace-pre-wrap">{device.notes}</p>
            </div>
          )}

          {/* Services (skipped for Zigbee devices — they don't have IP services) */}
          {!isZigbee && <div>
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
              Services found ({device.services.length})
            </p>
            {device.services.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No services detected</p>
            ) : (
              <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
                {device.services.map((svc, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 px-2.5 py-1.5 rounded bg-[#21262d] border border-[#30363d] text-xs"
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ backgroundColor: categoryColor(svc.category) }}
                    />
                    <span className="font-mono text-[#00d4ff] w-10 shrink-0">{svc.port}</span>
                    <span className="text-muted-foreground w-7 shrink-0">{svc.protocol}</span>
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
          </div>}

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            {/* Rack gear is mounted from a rack canvas, never approved onto a
                logical one — so it gets no Approve button at all. */}
            {!rackOnly && (
              <Button
                size="sm"
                className="flex-1 bg-[#39d353]/15 text-[#39d353] hover:bg-[#39d353]/25 border border-[#39d353]/30"
                onClick={handleApprove}
              >
                Approve
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="flex-1 text-[#00d4ff] hover:text-[#00d4ff] hover:bg-[#00d4ff]/10"
              onClick={() => setEditing(true)}
            >
              Edit
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="flex-1 text-muted-foreground hover:text-foreground hover:bg-[#30363d]"
              onClick={handleHide}
            >
              Hide
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="flex-1 text-[#f85149] hover:text-[#f85149] hover:bg-[#f85149]/10"
              onClick={handleIgnore}
            >
              Delete
            </Button>
          </div>
        </div>
        )}

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

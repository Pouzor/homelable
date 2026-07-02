import { useState } from 'react'
import { RadioTower, Share2, Cpu, CheckCircle2, XCircle, Loader2, Plus } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { zwaveApi } from '@/api/client'
import { toast } from 'sonner'
import type { ZwaveNode, ZwaveEdge } from './types'

interface ZwaveImportModalProps {
  open: boolean
  onClose: () => void
  onAddToCanvas: (nodes: ZwaveNode[], edges: ZwaveEdge[]) => void
  onPendingImported?: (
    coordinator?: { id: string; label: string; ieee_address: string } | null,
  ) => void
}

type ImportMode = 'pending' | 'canvas'

const ACCENT = '#ff6e00'

interface ConnectionForm {
  mqtt_host: string
  mqtt_port: string
  mqtt_username: string
  mqtt_password: string
  prefix: string
  gateway_name: string
  mqtt_tls: boolean
  mqtt_tls_insecure: boolean
  port_user_edited: boolean
}

const DEFAULT_FORM: ConnectionForm = {
  mqtt_host: '',
  mqtt_port: '1883',
  mqtt_username: '',
  mqtt_password: '',
  prefix: 'zwave',
  gateway_name: 'zwavejs2mqtt',
  mqtt_tls: false,
  mqtt_tls_insecure: false,
  port_user_edited: false,
}

const DEVICE_TYPE_ICON = {
  zwave_coordinator: RadioTower,
  zwave_router: Share2,
  zwave_enddevice: Cpu,
} as const

const DEVICE_TYPE_LABEL = {
  zwave_coordinator: 'Controller',
  zwave_router: 'Router',
  zwave_enddevice: 'End Device',
} as const

const DEVICE_TYPE_COLOR = {
  zwave_coordinator: '#ff6e00',
  zwave_router: '#39d353',
  zwave_enddevice: '#e3b341',
} as const

export function ZwaveImportModal({ open, onClose, onAddToCanvas, onPendingImported }: ZwaveImportModalProps) {
  const [form, setForm] = useState<ConnectionForm>(DEFAULT_FORM)
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle')
  const [connectionMsg, setConnectionMsg] = useState('')
  const [loading, setLoading] = useState(false)
  const [devices, setDevices] = useState<ZwaveNode[]>([])
  const [edges, setEdges] = useState<ZwaveEdge[]>([])
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [importMode, setImportMode] = useState<ImportMode>('pending')

  const updateField = (field: keyof ConnectionForm, value: string) =>
    setForm((f) => ({
      ...f,
      [field]: value,
      ...(field === 'mqtt_port' ? { port_user_edited: true } : {}),
    }))

  const toggleTls = (next: boolean) =>
    setForm((f) => {
      const port = f.port_user_edited
        ? f.mqtt_port
        : next
          ? '8883'
          : '1883'
      return {
        ...f,
        mqtt_tls: next,
        mqtt_tls_insecure: next ? f.mqtt_tls_insecure : false,
        mqtt_port: port,
      }
    })

  const buildPayload = () => ({
    mqtt_host: form.mqtt_host.trim(),
    mqtt_port: Number(form.mqtt_port) || (form.mqtt_tls ? 8883 : 1883),
    mqtt_username: form.mqtt_username.trim() || undefined,
    mqtt_password: form.mqtt_password || undefined,
    prefix: form.prefix.trim() || 'zwave',
    gateway_name: form.gateway_name.trim() || 'zwavejs2mqtt',
    mqtt_tls: form.mqtt_tls,
    mqtt_tls_insecure: form.mqtt_tls_insecure,
  })

  const handleTestConnection = async () => {
    if (!form.mqtt_host.trim()) { toast.error('Enter a broker hostname'); return }
    setConnectionStatus('testing')
    try {
      const res = await zwaveApi.testConnection({
        mqtt_host: form.mqtt_host.trim(),
        mqtt_port: Number(form.mqtt_port) || (form.mqtt_tls ? 8883 : 1883),
        mqtt_username: form.mqtt_username.trim() || undefined,
        mqtt_password: form.mqtt_password || undefined,
        mqtt_tls: form.mqtt_tls,
        mqtt_tls_insecure: form.mqtt_tls_insecure,
      })
      if (res.data.connected) {
        setConnectionStatus('ok')
        setConnectionMsg(res.data.message)
      } else {
        setConnectionStatus('fail')
        setConnectionMsg(res.data.message)
      }
    } catch {
      setConnectionStatus('fail')
      setConnectionMsg('Request failed — check broker address')
    }
  }

  const extractError = (err: unknown): string | undefined => {
    if (err && typeof err === 'object' && 'response' in err) {
      return (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
    }
    return undefined
  }

  const handleFetchDevices = async () => {
    if (!form.mqtt_host.trim()) { toast.error('Enter a broker hostname'); return }
    setLoading(true)
    try {
      if (importMode === 'pending') {
        await zwaveApi.importToPending(buildPayload())
        toast.success('Z-Wave import started — track progress in Scan History')
        onPendingImported?.(null)
        handleClose()
      } else {
        const res = await zwaveApi.importNetwork(buildPayload())
        setDevices(res.data.nodes)
        setEdges(res.data.edges)
        setChecked(new Set(res.data.nodes.map((n) => n.id)))
        if (res.data.device_count === 0) {
          toast.info('No Z-Wave devices found')
        } else {
          toast.success(`Found ${res.data.device_count} device${res.data.device_count !== 1 ? 's' : ''}`)
        }
      }
    } catch (err: unknown) {
      toast.error(extractError(err) ?? 'Failed to fetch Z-Wave devices')
    } finally {
      setLoading(false)
    }
  }

  const toggleCheck = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })

  const toggleAll = () => {
    setChecked(checked.size === devices.length ? new Set() : new Set(devices.map((d) => d.id)))
  }

  const handleAddToCanvas = () => {
    const selectedDevices = devices.filter((d) => checked.has(d.id))
    const selectedIds = new Set(selectedDevices.map((d) => d.id))
    const selectedEdges = edges.filter((e) => selectedIds.has(e.source) && selectedIds.has(e.target))
    onAddToCanvas(selectedDevices, selectedEdges)
    toast.success(`Added ${selectedDevices.length} device${selectedDevices.length !== 1 ? 's' : ''} to canvas`)
    onClose()
  }

  const handleClose = () => {
    setDevices([])
    setEdges([])
    setChecked(new Set())
    setConnectionStatus('idle')
    setConnectionMsg('')
    setImportMode('pending')
    onClose()
  }

  const groupedDevices = {
    zwave_coordinator: devices.filter((d) => d.type === 'zwave_coordinator'),
    zwave_router: devices.filter((d) => d.type === 'zwave_router'),
    zwave_enddevice: devices.filter((d) => d.type === 'zwave_enddevice'),
  } as const

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="bg-[#161b22] border-border max-w-xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-foreground flex items-center gap-2">
            <RadioTower size={16} style={{ color: ACCENT }} />
            Z-Wave Import
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-2 min-h-0">
          {/* Connection Form */}
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1">
                <Label className="text-xs text-muted-foreground">Broker Host</Label>
                <Input
                  value={form.mqtt_host}
                  onChange={(e) => updateField('mqtt_host', e.target.value)}
                  placeholder="192.168.1.x or mqtt.local"
                  className="font-mono text-sm bg-[#0d1117] border-border"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Port</Label>
                <Input
                  value={form.mqtt_port}
                  onChange={(e) => updateField('mqtt_port', e.target.value)}
                  placeholder="1883"
                  type="number"
                  className="font-mono text-sm bg-[#0d1117] border-border"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">MQTT Prefix</Label>
                <Input
                  value={form.prefix}
                  onChange={(e) => updateField('prefix', e.target.value)}
                  placeholder="zwave"
                  className="font-mono text-sm bg-[#0d1117] border-border"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Gateway Name</Label>
                <Input
                  value={form.gateway_name}
                  onChange={(e) => updateField('gateway_name', e.target.value)}
                  placeholder="zwavejs2mqtt"
                  className="font-mono text-sm bg-[#0d1117] border-border"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Username (optional)</Label>
                <Input
                  value={form.mqtt_username}
                  onChange={(e) => updateField('mqtt_username', e.target.value)}
                  placeholder="mqtt_user"
                  className="text-sm bg-[#0d1117] border-border"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Password (optional)</Label>
                <Input
                  value={form.mqtt_password}
                  onChange={(e) => updateField('mqtt_password', e.target.value)}
                  placeholder="••••••••"
                  type="password"
                  autoComplete="new-password"
                  className="text-sm bg-[#0d1117] border-border"
                />
              </div>
              <div className="col-span-2 flex items-center gap-4 pt-1">
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.mqtt_tls}
                    onChange={(e) => toggleTls(e.target.checked)}
                    className="w-3 h-3 cursor-pointer"
                    style={{ accentColor: ACCENT }}
                  />
                  Use TLS (port 8883)
                </label>
                <label
                  className={`flex items-center gap-1.5 text-xs cursor-pointer ${
                    form.mqtt_tls ? 'text-[#f85149]' : 'text-muted-foreground/40 cursor-not-allowed'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={form.mqtt_tls_insecure}
                    disabled={!form.mqtt_tls}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, mqtt_tls_insecure: e.target.checked }))
                    }
                    className="w-3 h-3 accent-[#f85149] cursor-pointer disabled:cursor-not-allowed"
                  />
                  Skip cert verify (self-signed only)
                </label>
              </div>
            </div>

            {/* Connection status indicator */}
            {connectionStatus !== 'idle' && (
              <div className={`flex items-center gap-1.5 text-xs px-2 py-1.5 rounded-md border ${
                connectionStatus === 'ok'
                  ? 'bg-[#39d353]/10 border-[#39d353]/30 text-[#39d353]'
                  : connectionStatus === 'fail'
                  ? 'bg-[#f85149]/10 border-[#f85149]/30 text-[#f85149]'
                  : 'bg-[#e3b341]/10 border-[#e3b341]/30 text-[#e3b341]'
              }`}>
                {connectionStatus === 'testing' && <Loader2 size={12} className="animate-spin" />}
                {connectionStatus === 'ok' && <CheckCircle2 size={12} />}
                {connectionStatus === 'fail' && <XCircle size={12} />}
                <span>{connectionStatus === 'testing' ? 'Testing…' : connectionMsg}</span>
              </div>
            )}

            <div className="flex items-center gap-3 text-xs">
              <span className="text-muted-foreground">Send devices to:</span>
              <label className="flex items-center gap-1.5 cursor-pointer text-foreground">
                <input
                  type="radio"
                  name="zwave-import-mode"
                  checked={importMode === 'pending'}
                  onChange={() => setImportMode('pending')}
                  className="cursor-pointer"
                  style={{ accentColor: ACCENT }}
                />
                Pending section
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer text-foreground">
                <input
                  type="radio"
                  name="zwave-import-mode"
                  checked={importMode === 'canvas'}
                  onChange={() => setImportMode('canvas')}
                  className="cursor-pointer"
                  style={{ accentColor: ACCENT }}
                />
                Canvas directly
              </label>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="ghost"
                className="gap-1.5 text-muted-foreground hover:text-foreground border border-border hover:bg-[#21262d]"
                onClick={handleTestConnection}
                disabled={connectionStatus === 'testing' || loading}
              >
                {connectionStatus === 'testing'
                  ? <Loader2 size={13} className="animate-spin" />
                  : <CheckCircle2 size={13} />}
                Test Connection
              </Button>
              <Button
                size="sm"
                style={{ background: ACCENT, color: '#0d1117' }}
                className="gap-1.5"
                onClick={handleFetchDevices}
                disabled={loading || connectionStatus === 'testing'}
              >
                {loading ? <Loader2 size={13} className="animate-spin" /> : <RadioTower size={13} />}
                {importMode === 'pending' ? 'Import to Pending' : 'Fetch Devices'}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground italic">
              Make sure the gateway name matches your Z-Wave JS UI configuration.
            </p>
          </div>

          {/* Device List */}
          {devices.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={checked.size === devices.length}
                    ref={(el) => { if (el) el.indeterminate = checked.size > 0 && checked.size < devices.length }}
                    onChange={toggleAll}
                    className="w-3 h-3 cursor-pointer"
                    style={{ accentColor: ACCENT }}
                    title="Select all"
                  />
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Devices ({checked.size}/{devices.length} selected)
                  </span>
                </div>
              </div>

              {(Object.entries(groupedDevices) as [keyof typeof groupedDevices, ZwaveNode[]][])
                .filter(([, group]) => group.length > 0)
                .map(([type, group]) => {
                  const Icon = DEVICE_TYPE_ICON[type]
                  const color = DEVICE_TYPE_COLOR[type]
                  return (
                    <div key={type}>
                      <div className="flex items-center gap-1.5 mb-1">
                        <Icon size={11} style={{ color }} />
                        <span className="text-[10px] font-medium uppercase tracking-wider" style={{ color }}>
                          {DEVICE_TYPE_LABEL[type]} ({group.length})
                        </span>
                      </div>
                      {group.map((device) => (
                        <div
                          key={device.id}
                          className={`flex items-start gap-2 p-2 mb-1 rounded-md text-xs cursor-pointer transition-colors border ${
                            checked.has(device.id)
                              ? 'bg-[#21262d] border-[#ff6e00]/40'
                              : 'bg-[#21262d] border-transparent hover:bg-[#30363d]'
                          }`}
                          onClick={() => toggleCheck(device.id)}
                        >
                          <input
                            type="checkbox"
                            checked={checked.has(device.id)}
                            onChange={() => toggleCheck(device.id)}
                            onClick={(e) => e.stopPropagation()}
                            className="w-3 h-3 mt-0.5 cursor-pointer shrink-0"
                            style={{ accentColor: ACCENT }}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="text-foreground font-medium truncate">{device.friendly_name}</div>
                            <div className="font-mono text-[10px] text-muted-foreground truncate">{device.ieee_address}</div>
                            {(device.model || device.vendor) && (
                              <div className="text-[10px] text-muted-foreground truncate">
                                {[device.vendor, device.model].filter(Boolean).join(' · ')}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                })}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 shrink-0 pt-2 border-t border-border">
          <Button variant="ghost" onClick={handleClose}>Cancel</Button>
          {devices.length > 0 && (
            <Button
              onClick={handleAddToCanvas}
              disabled={checked.size === 0}
              style={{ background: ACCENT, color: '#0d1117' }}
              className="gap-1.5"
            >
              <Plus size={13} />
              Add {checked.size} to Canvas
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

import { useState } from 'react'
import { HardDrive, Package, CheckCircle2, XCircle, Loader2, Plus } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { synologyApi, type SynologyConnection } from '@/api/client'
import { toast } from 'sonner'
import type { SynologyEdge, SynologyNode, SynologyNodeType } from './types'

interface SynologyImportModalProps {
  open: boolean
  onClose: () => void
  onAddToCanvas: (nodes: SynologyNode[], edges: SynologyEdge[]) => void
  onInventoryImported?: () => void
}

type ImportMode = 'pending' | 'canvas'

const ACCENT = '#1e8fff'

const DEVICE_TYPE_ICON: Record<SynologyNodeType, typeof HardDrive> = {
  nas: HardDrive,
  docker_container: Package,
}

const DEVICE_TYPE_LABEL: Record<SynologyNodeType, string> = {
  nas: 'NAS',
  docker_container: 'Containers',
}

const DEVICE_TYPE_COLOR: Record<SynologyNodeType, string> = {
  nas: '#1e8fff',
  docker_container: '#39d353',
}

interface ConnectionForm {
  host: string
  port: string
  username: string
  password: string
  otp_code: string
  verify_tls: boolean
}

const DEFAULT_FORM: ConnectionForm = {
  host: '',
  port: '5001',
  username: '',
  password: '',
  otp_code: '',
  verify_tls: true,
}

export function SynologyImportModal({ open, onClose, onAddToCanvas, onInventoryImported }: SynologyImportModalProps) {
  const [form, setForm] = useState<ConnectionForm>(DEFAULT_FORM)
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle')
  const [connectionMsg, setConnectionMsg] = useState('')
  const [loading, setLoading] = useState(false)
  const [devices, setDevices] = useState<SynologyNode[]>([])
  const [edges, setEdges] = useState<SynologyEdge[]>([])
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [importMode, setImportMode] = useState<ImportMode>('pending')

  const updateField = (field: keyof ConnectionForm, value: string) =>
    setForm((f) => ({ ...f, [field]: value }))

  const buildPayload = (): SynologyConnection => ({
    host: form.host.trim(),
    port: Number(form.port) || 5001,
    username: form.username.trim() || undefined,
    password: form.password || undefined,
    otp_code: form.otp_code.trim() || undefined,
    verify_tls: form.verify_tls,
  })

  const extractError = (err: unknown): string | undefined => {
    if (err && typeof err === 'object' && 'response' in err) {
      return (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
    }
    return undefined
  }

  const handleTestConnection = async () => {
    if (!form.host.trim()) { toast.error('Enter a Synology host'); return }
    setConnectionStatus('testing')
    try {
      const res = await synologyApi.testConnection(buildPayload())
      setConnectionStatus(res.data.connected ? 'ok' : 'fail')
      setConnectionMsg(res.data.message)
    } catch (err) {
      setConnectionStatus('fail')
      setConnectionMsg(extractError(err) ?? 'Request failed — check host address')
    }
  }

  const handleFetchDevices = async () => {
    if (!form.host.trim()) { toast.error('Enter a Synology host'); return }
    setLoading(true)
    try {
      if (importMode === 'pending') {
        await synologyApi.importToPending(buildPayload())
        toast.success('Synology import started — track progress in Scan History')
        onInventoryImported?.()
        handleClose()
      } else {
        const res = await synologyApi.importNetwork(buildPayload())
        setDevices(res.data.nodes)
        setEdges(res.data.edges ?? [])
        setChecked(new Set(res.data.nodes.map((n) => n.id)))
        if (res.data.device_count === 0) {
          toast.info('No Synology NAS found')
        } else {
          toast.success(`Found ${res.data.device_count} device${res.data.device_count !== 1 ? 's' : ''}`)
        }
      }
    } catch (err: unknown) {
      toast.error(extractError(err) ?? 'Failed to fetch Synology inventory')
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

  const groupedDevices: Record<SynologyNodeType, SynologyNode[]> = {
    nas: devices.filter((d) => d.type === 'nas'),
    docker_container: devices.filter((d) => d.type === 'docker_container'),
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="bg-[#161b22] border-border max-w-xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-foreground flex items-center gap-2">
            <HardDrive size={16} style={{ color: ACCENT }} />
            Synology DSM Import
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-2 min-h-0">
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1">
                <Label className="text-xs text-muted-foreground">Synology Host</Label>
                <Input
                  value={form.host}
                  onChange={(e) => updateField('host', e.target.value)}
                  placeholder="192.168.1.x or nas.local"
                  className="font-mono text-sm bg-[#0d1117] border-border"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Port</Label>
                <Input
                  value={form.port}
                  onChange={(e) => updateField('port', e.target.value)}
                  placeholder="5001"
                  type="number"
                  className="font-mono text-sm bg-[#0d1117] border-border"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Username</Label>
                <Input
                  value={form.username}
                  onChange={(e) => updateField('username', e.target.value)}
                  placeholder="homelable"
                  className="font-mono text-sm bg-[#0d1117] border-border"
                  autoComplete="username"
                />
              </div>
              <div className="col-span-2 space-y-1">
                <Label className="text-xs text-muted-foreground">Password</Label>
                <Input
                  value={form.password}
                  onChange={(e) => updateField('password', e.target.value)}
                  placeholder="••••••••"
                  type="password"
                  autoComplete="new-password"
                  className="text-sm bg-[#0d1117] border-border"
                />
              </div>
              <div className="col-span-2 space-y-1">
                <Label className="text-xs text-muted-foreground">OTP (2FA, optional)</Label>
                <Input
                  value={form.otp_code}
                  onChange={(e) => updateField('otp_code', e.target.value)}
                  placeholder="123456"
                  className="font-mono text-sm bg-[#0d1117] border-border"
                  autoComplete="one-time-code"
                />
              </div>
              <div className="col-span-2 flex items-center gap-4 pt-1">
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.verify_tls}
                    onChange={(e) => setForm((f) => ({ ...f, verify_tls: e.target.checked }))}
                    className="w-3 h-3 cursor-pointer"
                    style={{ accentColor: ACCENT }}
                  />
                  Verify TLS certificate
                </label>
              </div>
            </div>

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
                  name="synology-import-mode"
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
                  name="synology-import-mode"
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
                {loading ? <Loader2 size={13} className="animate-spin" /> : <HardDrive size={13} />}
                {importMode === 'pending' ? 'Import to Pending' : 'Fetch Inventory'}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground italic">
              Leave username and password blank to use the credentials configured on the server (.env).
              A dedicated limited DSM user is enough. OTP is for one-off 2FA only.
            </p>
          </div>

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

              {(Object.entries(groupedDevices) as [SynologyNodeType, SynologyNode[]][])
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
                              ? 'bg-[#21262d] border-[#1e8fff]/40'
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
                            <div className="text-foreground font-medium truncate">{device.label}</div>
                            {device.ip && (
                              <div className="font-mono text-[10px] text-muted-foreground truncate">{device.ip}</div>
                            )}
                            <div className="text-[10px] text-muted-foreground truncate">
                              {[
                                device.image,
                                device.model,
                                device.ram_gb ? `${device.ram_gb} GB RAM` : null,
                                device.disk_gb ? `${device.disk_gb} GB disk` : null,
                                device.status,
                              ].filter(Boolean).join(' · ')}
                            </div>
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

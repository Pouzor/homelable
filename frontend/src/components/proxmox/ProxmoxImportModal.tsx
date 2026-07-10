import { useState } from 'react'
import { Server, Box, Container, CheckCircle2, XCircle, Loader2, Plus } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { proxmoxApi, type ProxmoxConnection } from '@/api/client'
import { toast } from 'sonner'
import type { ProxmoxNode, ProxmoxEdge, ProxmoxNodeType } from './types'

interface ProxmoxImportModalProps {
  open: boolean
  onClose: () => void
  onAddToCanvas: (nodes: ProxmoxNode[], edges: ProxmoxEdge[], containerMode: boolean, columns: number) => void
  onPendingImported?: () => void
}

type ImportMode = 'pending' | 'canvas'

const ACCENT = '#e57000'

interface ConnectionForm {
  host: string
  port: string
  token_id: string
  token_secret: string
  verify_tls: boolean
}

const DEFAULT_FORM: ConnectionForm = {
  host: '',
  port: '8006',
  token_id: '',
  token_secret: '',
  verify_tls: true,
}

const DEVICE_TYPE_ICON: Record<ProxmoxNodeType, typeof Server> = {
  proxmox: Server,
  vm: Box,
  lxc: Container,
}

const DEVICE_TYPE_LABEL: Record<ProxmoxNodeType, string> = {
  proxmox: 'Hosts',
  vm: 'Virtual Machines',
  lxc: 'LXC Containers',
}

const DEVICE_TYPE_COLOR: Record<ProxmoxNodeType, string> = {
  proxmox: '#e57000',
  vm: '#00d4ff',
  lxc: '#39d353',
}

export function ProxmoxImportModal({ open, onClose, onAddToCanvas, onPendingImported }: ProxmoxImportModalProps) {
  const [form, setForm] = useState<ConnectionForm>(DEFAULT_FORM)
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle')
  const [connectionMsg, setConnectionMsg] = useState('')
  const [loading, setLoading] = useState(false)
  const [devices, setDevices] = useState<ProxmoxNode[]>([])
  const [edges, setEdges] = useState<ProxmoxEdge[]>([])
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [importMode, setImportMode] = useState<ImportMode>('pending')
  const [containerMode, setContainerMode] = useState(false)
  const [columns, setColumns] = useState(2)

  const updateField = (field: keyof ConnectionForm, value: string) =>
    setForm((f) => ({ ...f, [field]: value }))

  const buildPayload = (): ProxmoxConnection => ({
    host: form.host.trim(),
    port: Number(form.port) || 8006,
    token_id: form.token_id.trim() || undefined,
    token_secret: form.token_secret || undefined,
    verify_tls: form.verify_tls,
  })

  const extractError = (err: unknown): string | undefined => {
    if (err && typeof err === 'object' && 'response' in err) {
      return (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
    }
    return undefined
  }

  const handleTestConnection = async () => {
    if (!form.host.trim()) { toast.error('Enter a Proxmox host'); return }
    setConnectionStatus('testing')
    try {
      const res = await proxmoxApi.testConnection(buildPayload())
      setConnectionStatus(res.data.connected ? 'ok' : 'fail')
      setConnectionMsg(res.data.message)
    } catch (err) {
      setConnectionStatus('fail')
      setConnectionMsg(extractError(err) ?? 'Request failed — check host address')
    }
  }

  const handleFetchDevices = async () => {
    if (!form.host.trim()) { toast.error('Enter a Proxmox host'); return }
    setLoading(true)
    try {
      if (importMode === 'pending') {
        await proxmoxApi.importToPending(buildPayload())
        toast.success('Proxmox import started — track progress in Scan History')
        onPendingImported?.()
        handleClose()
      } else {
        const res = await proxmoxApi.importNetwork(buildPayload())
        setDevices(res.data.nodes)
        setEdges(res.data.edges)
        setChecked(new Set(res.data.nodes.map((n) => n.id)))
        if (res.data.device_count === 0) {
          toast.info('No Proxmox guests found')
        } else {
          toast.success(`Found ${res.data.device_count} device${res.data.device_count !== 1 ? 's' : ''}`)
        }
      }
    } catch (err: unknown) {
      toast.error(extractError(err) ?? 'Failed to fetch Proxmox inventory')
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
    onAddToCanvas(selectedDevices, selectedEdges, containerMode, columns)
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
    setContainerMode(false)
    setColumns(2)
    onClose()
  }

  const groupedDevices: Record<ProxmoxNodeType, ProxmoxNode[]> = {
    proxmox: devices.filter((d) => d.type === 'proxmox'),
    vm: devices.filter((d) => d.type === 'vm'),
    lxc: devices.filter((d) => d.type === 'lxc'),
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="bg-[#161b22] border-border max-w-xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-foreground flex items-center gap-2">
            <Server size={16} style={{ color: ACCENT }} />
            Proxmox VE Import
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-2 min-h-0">
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1">
                <Label className="text-xs text-muted-foreground">Proxmox Host</Label>
                <Input
                  value={form.host}
                  onChange={(e) => updateField('host', e.target.value)}
                  placeholder="192.168.1.x or pve.local"
                  className="font-mono text-sm bg-[#0d1117] border-border"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Port</Label>
                <Input
                  value={form.port}
                  onChange={(e) => updateField('port', e.target.value)}
                  placeholder="8006"
                  type="number"
                  className="font-mono text-sm bg-[#0d1117] border-border"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Token ID</Label>
                <Input
                  value={form.token_id}
                  onChange={(e) => updateField('token_id', e.target.value)}
                  placeholder="user@pam!tokenname"
                  className="font-mono text-sm bg-[#0d1117] border-border"
                />
              </div>
              <div className="col-span-2 space-y-1">
                <Label className="text-xs text-muted-foreground">Token Secret</Label>
                <Input
                  value={form.token_secret}
                  onChange={(e) => updateField('token_secret', e.target.value)}
                  placeholder="••••••••-••••-••••-••••-••••••••••••"
                  type="password"
                  autoComplete="new-password"
                  className="text-sm bg-[#0d1117] border-border"
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
                  name="proxmox-import-mode"
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
                  name="proxmox-import-mode"
                  checked={importMode === 'canvas'}
                  onChange={() => setImportMode('canvas')}
                  className="cursor-pointer"
                  style={{ accentColor: ACCENT }}
                />
                Canvas directly
              </label>
            </div>
            {importMode === 'canvas' && (
              <div className="flex flex-col gap-1.5">
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={containerMode}
                    onChange={(e) => setContainerMode(e.target.checked)}
                    className="w-3 h-3 cursor-pointer"
                    style={{ accentColor: ACCENT }}
                  />
                  Nest VMs &amp; LXCs within host containers
                </label>
                {containerMode && (
                  <label className="flex items-center gap-2 text-xs text-muted-foreground pl-4">
                    Columns per host:
                    <div className="flex items-center gap-1">
                      {([1, 2, 3, 4] as const).map((n) => (
                        <button
                          key={n}
                          type="button"
                          onClick={() => setColumns(n)}
                          className="w-5 h-5 rounded text-[10px] font-bold leading-none flex items-center justify-center transition-colors border"
                          style={{
                            background: columns === n ? ACCENT : 'transparent',
                            color: columns === n ? '#0d1117' : ACCENT,
                            borderColor: `${ACCENT}66`,
                          }}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                  </label>
                )}
              </div>
            )}
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
                {loading ? <Loader2 size={13} className="animate-spin" /> : <Server size={13} />}
                {importMode === 'pending' ? 'Import to Pending' : 'Fetch Inventory'}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground italic">
              Leave the token blank to use the token configured on the server (.env).
              A read-only <span className="font-mono">PVEAuditor</span> role is enough.
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

              {(Object.entries(groupedDevices) as [ProxmoxNodeType, ProxmoxNode[]][])
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
                              ? 'bg-[#21262d] border-[#e57000]/40'
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
                                device.cpu_count ? `${device.cpu_count} vCPU` : null,
                                device.ram_gb ? `${device.ram_gb} GB RAM` : null,
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

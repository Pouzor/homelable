import { useState } from 'react'
import { Wifi, CheckCircle2, XCircle, Loader2, Download } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { unifiApi, type UnifiImportModes } from '@/api/client'
import { toast } from 'sonner'

interface UnifiImportModalProps {
  open: boolean
  onClose: () => void
  onInventoryImported?: () => void
}

interface ConnectionForm {
  host: string
  port: string
  site: string
  username: string
  password: string
  verify_tls: boolean
}

const DEFAULT_FORM: ConnectionForm = {
  host: '',
  port: '8443',
  site: 'default',
  username: '',
  password: '',
  verify_tls: false,
}

const DEFAULT_MODES: UnifiImportModes = {
  infrastructure: true,
  known_clients: false,
  active_clients: false,
}

/**
 * The controller holds three inventories and they are not interchangeable, so
 * each is its own opt-in rather than one "import everything" button.
 */
const SOURCES: {
  key: keyof UnifiImportModes
  label: string
  endpoint: string
  hint: string
}[] = [
  {
    key: 'infrastructure',
    label: 'Infrastructure',
    endpoint: 'stat/device',
    hint: 'Adopted APs, switches and gateways — with IP, model and firmware.',
  },
  {
    key: 'known_clients',
    label: 'Known clients',
    endpoint: 'list/user',
    hint: 'Every client the controller has ever recorded. No IP address, and long on a busy site.',
  },
  {
    key: 'active_clients',
    label: 'Active clients',
    endpoint: 'stat/sta',
    hint: 'Clients connected right now — carries the IP and the switch port or AP.',
  },
]

export function UnifiImportModal({ open, onClose, onInventoryImported }: UnifiImportModalProps) {
  const [form, setForm] = useState<ConnectionForm>(DEFAULT_FORM)
  const [modes, setModes] = useState<UnifiImportModes>(DEFAULT_MODES)
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle')
  const [connectionMsg, setConnectionMsg] = useState('')
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [importing, setImporting] = useState(false)

  const anyMode = modes.infrastructure || modes.known_clients || modes.active_clients

  const updateField = (field: keyof ConnectionForm, value: string) =>
    setForm((f) => ({ ...f, [field]: value }))

  const toggleMode = (key: keyof UnifiImportModes) =>
    setModes((m) => ({ ...m, [key]: !m[key] }))

  const buildPayload = () => ({
    host: form.host.trim(),
    port: Number(form.port) || 8443,
    site: form.site.trim() || 'default',
    // Blank falls back to the server env, like every other import.
    username: form.username.trim() || undefined,
    password: form.password || undefined,
    verify_tls: form.verify_tls,
    modes,
  })

  const handleClose = () => {
    setForm(DEFAULT_FORM)
    setModes(DEFAULT_MODES)
    setConnectionStatus('idle')
    setConnectionMsg('')
    setCounts({})
    onClose()
  }

  const handleTestConnection = async () => {
    if (!form.host.trim()) { toast.error('Enter a controller host'); return }
    setConnectionStatus('testing')
    try {
      const res = await unifiApi.testConnection(buildPayload())
      setConnectionStatus(res.data.connected ? 'ok' : 'fail')
      setConnectionMsg(res.data.message)
      setCounts(res.data.counts || {})
    } catch (e) {
      setConnectionStatus('fail')
      setConnectionMsg(e instanceof Error ? e.message : 'Connection failed')
      setCounts({})
    }
  }

  const handleImport = async () => {
    if (!form.host.trim()) { toast.error('Enter a controller host'); return }
    if (!anyMode) { toast.error('Select at least one source'); return }
    setImporting(true)
    try {
      const res = await unifiApi.importToPending(buildPayload())
      const { pending_created, pending_updated, infra_count, client_count } = res.data
      toast.success(
        `Imported ${infra_count} device(s) and ${client_count} client(s) — ` +
        `${pending_created} new, ${pending_updated} updated`,
      )
      onInventoryImported?.()
      handleClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'UniFi import failed')
    } finally {
      setImporting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="bg-[#161b22] border-border max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-foreground flex items-center gap-2">
            <Wifi size={16} className="text-[#0559c9]" />
            UniFi Import
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-2 min-h-0">
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              <div className="col-span-2 space-y-1">
                <Label className="text-xs text-muted-foreground">Controller Host</Label>
                <Input
                  value={form.host}
                  onChange={(e) => updateField('host', e.target.value)}
                  placeholder="192.168.1.x or unifi.local"
                  className="font-mono text-sm bg-[#0d1117] border-border"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Port</Label>
                <Input
                  value={form.port}
                  onChange={(e) => updateField('port', e.target.value)}
                  placeholder="8443"
                  type="number"
                  className="font-mono text-sm bg-[#0d1117] border-border"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Site</Label>
                <Input
                  value={form.site}
                  onChange={(e) => updateField('site', e.target.value)}
                  placeholder="default"
                  className="font-mono text-sm bg-[#0d1117] border-border"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Username (optional)</Label>
                <Input
                  value={form.username}
                  onChange={(e) => updateField('username', e.target.value)}
                  placeholder="falls back to server env"
                  className="text-sm bg-[#0d1117] border-border"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Password (optional)</Label>
                <Input
                  value={form.password}
                  onChange={(e) => updateField('password', e.target.value)}
                  placeholder="••••••••"
                  type="password"
                  autoComplete="new-password"
                  className="text-sm bg-[#0d1117] border-border"
                />
              </div>
              <div className="col-span-2 flex flex-wrap items-center gap-x-6 gap-y-2 pt-1">
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.verify_tls}
                    onChange={(e) => setForm((f) => ({ ...f, verify_tls: e.target.checked }))}
                    className="w-3 h-3 accent-[#0559c9] cursor-pointer"
                  />
                  Verify TLS certificate
                  <span className="text-muted-foreground/50">(off for a self-signed controller)</span>
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

            <div className="space-y-2 rounded-md border border-border bg-[#0d1117]/60 px-3 py-2.5">
              <span className="block text-xs text-muted-foreground">Import from</span>
              <div className="space-y-2">
                {SOURCES.map((s) => (
                  <label
                    key={s.key}
                    className="flex items-start gap-2 text-xs cursor-pointer text-foreground"
                  >
                    <input
                      type="checkbox"
                      checked={modes[s.key]}
                      onChange={() => toggleMode(s.key)}
                      aria-label={s.label}
                      className="w-3 h-3 mt-0.5 accent-[#0559c9] cursor-pointer"
                    />
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-x-2">
                        {s.label}
                        <code className="font-mono text-[10px] text-muted-foreground/70">{s.endpoint}</code>
                        {counts[s.key] !== undefined && (
                          <span className="text-[#0559c9]">{counts[s.key]} found</span>
                        )}
                      </span>
                      <span className="block text-muted-foreground/60">{s.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
              {!anyMode && (
                <span className="block text-xs text-[#e3b341]">Select at least one source.</span>
              )}
            </div>

            <p className="text-xs text-muted-foreground/60">
              Everything lands in the device inventory as pending, to approve onto a canvas
              like any other discovery.
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2 shrink-0 pt-2 border-t border-border">
          <Button variant="ghost" onClick={handleClose}>Cancel</Button>
          <Button
            size="sm"
            variant="ghost"
            className="gap-1.5 text-muted-foreground hover:text-foreground border border-border hover:bg-[#21262d]"
            onClick={handleTestConnection}
            disabled={connectionStatus === 'testing' || importing}
          >
            {connectionStatus === 'testing'
              ? <Loader2 size={13} className="animate-spin" />
              : <CheckCircle2 size={13} />}
            Test Connection
          </Button>
          <Button
            onClick={handleImport}
            disabled={!anyMode || importing}
            style={{ background: '#0559c9', color: '#ffffff' }}
            className="gap-1.5"
          >
            {importing ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
            Import to Inventory
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

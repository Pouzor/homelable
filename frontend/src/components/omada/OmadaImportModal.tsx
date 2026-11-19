import { useState } from 'react'
import { Router, CheckCircle2, XCircle, Loader2, Download } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { omadaApi, type OmadaImportModes } from '@/api/client'
import { toast } from 'sonner'

const ACCENT = '#21b6c4'

interface OmadaImportModalProps {
  open: boolean
  onClose: () => void
  onInventoryImported?: () => void
}

interface ConnectionForm {
  url: string
  omada_id: string
  client_id: string
  client_secret: string
  site: string
  verify_tls: boolean
}

const DEFAULT_FORM: ConnectionForm = {
  url: '',
  omada_id: '',
  client_id: '',
  client_secret: '',
  site: '',
  verify_tls: false,
}

const DEFAULT_MODES: OmadaImportModes = {
  infrastructure: true,
  clients: false,
}

const SOURCES: { key: keyof OmadaImportModes; label: string; hint: string }[] = [
  {
    key: 'infrastructure',
    label: 'Infrastructure',
    hint: 'Adopted gateways, switches and APs — with IP, model, firmware and uplink.',
  },
  {
    key: 'clients',
    label: 'Clients',
    hint: 'Clients connected right now — with IP and the switch port or AP they use.',
  },
]

export function OmadaImportModal({ open, onClose, onInventoryImported }: OmadaImportModalProps) {
  const [form, setForm] = useState<ConnectionForm>(DEFAULT_FORM)
  const [modes, setModes] = useState<OmadaImportModes>(DEFAULT_MODES)
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle')
  const [connectionMsg, setConnectionMsg] = useState('')
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [importing, setImporting] = useState(false)

  const anyMode = modes.infrastructure || modes.clients

  const updateField = (field: Exclude<keyof ConnectionForm, 'verify_tls'>, value: string) =>
    setForm((f) => ({ ...f, [field]: value }))

  const toggleMode = (key: keyof OmadaImportModes) =>
    setModes((m) => ({ ...m, [key]: !m[key] }))

  const buildPayload = () => ({
    url: form.url.trim(),
    // Blank: read from a local controller, or from the server env.
    omada_id: form.omada_id.trim() || undefined,
    // Blank falls back to the server env, like every other import.
    client_id: form.client_id.trim() || undefined,
    client_secret: form.client_secret || undefined,
    site: form.site.trim(),
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
    if (!form.url.trim()) { toast.error('Enter the controller URL'); return }
    setConnectionStatus('testing')
    try {
      const res = await omadaApi.testConnection(buildPayload())
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
    if (!form.url.trim()) { toast.error('Enter the controller URL'); return }
    if (!anyMode) { toast.error('Select at least one source'); return }
    setImporting(true)
    try {
      const res = await omadaApi.importToPending(buildPayload())
      const { pending_created, pending_updated, infra_count, client_count } = res.data
      toast.success(
        `Imported ${infra_count} device(s) and ${client_count} client(s) — ` +
        `${pending_created} new, ${pending_updated} updated`,
      )
      onInventoryImported?.()
      handleClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Omada import failed')
    } finally {
      setImporting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="bg-popover border-border max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-foreground flex items-center gap-2">
            <Router size={16} style={{ color: ACCENT }} />
            Omada Import
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-2 min-h-0">
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              <div className="col-span-2 space-y-1">
                <Label className="text-xs text-muted-foreground">Controller URL</Label>
                <Input
                  value={form.url}
                  onChange={(e) => updateField('url', e.target.value)}
                  placeholder="https://192.168.0.2:8043"
                  className="font-mono text-sm bg-background border-border"
                />
                <p className="text-[11px] text-muted-foreground/60">
                  Port 8043 for a software controller, 443 for an OC200/OC300. For a cloud-based
                  controller, the interface URL from Settings &gt; Platform Integration.
                </p>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Omada ID (optional)</Label>
                <Input
                  value={form.omada_id}
                  onChange={(e) => updateField('omada_id', e.target.value)}
                  placeholder="read from the controller"
                  className="font-mono text-sm bg-background border-border"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Site (optional)</Label>
                <Input
                  value={form.site}
                  onChange={(e) => updateField('site', e.target.value)}
                  placeholder="every site"
                  className="font-mono text-sm bg-background border-border"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Client ID (optional)</Label>
                <Input
                  value={form.client_id}
                  onChange={(e) => updateField('client_id', e.target.value)}
                  placeholder="Open API client ID"
                  className="font-mono text-sm bg-background border-border"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Client Secret (optional)</Label>
                <Input
                  value={form.client_secret}
                  onChange={(e) => updateField('client_secret', e.target.value)}
                  placeholder="••••••••"
                  type="password"
                  autoComplete="new-password"
                  className="text-sm bg-background border-border"
                />
              </div>
              <p className="col-span-2 text-[11px] text-muted-foreground/60">
                Create a client-mode application under Settings &gt; Platform Integration on the
                controller. The Omada ID is shown there too; a cloud-based controller needs it.
              </p>
              <div className="col-span-2 flex flex-wrap items-center gap-x-6 gap-y-2 pt-1">
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.verify_tls}
                    onChange={(e) => setForm((f) => ({ ...f, verify_tls: e.target.checked }))}
                    className="w-3 h-3 cursor-pointer"
                    style={{ accentColor: ACCENT }}
                  />
                  Verify TLS certificate
                  <span className="text-muted-foreground/50">(off for a self-signed controller)</span>
                </label>
              </div>
            </div>

            {connectionStatus !== 'idle' && (
              <div className={`flex items-center gap-1.5 text-xs px-2 py-1.5 rounded-md border ${
                connectionStatus === 'ok'
                  ? 'bg-success/10 border-success/30 text-success'
                  : connectionStatus === 'fail'
                  ? 'bg-destructive/10 border-destructive/30 text-destructive'
                  : 'bg-warning/10 border-warning/30 text-warning'
              }`}>
                {connectionStatus === 'testing' && <Loader2 size={12} className="animate-spin" />}
                {connectionStatus === 'ok' && <CheckCircle2 size={12} />}
                {connectionStatus === 'fail' && <XCircle size={12} />}
                <span>{connectionStatus === 'testing' ? 'Testing…' : connectionMsg}</span>
              </div>
            )}

            <div className="space-y-2 rounded-md border border-border bg-background/60 px-3 py-2.5">
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
                      className="w-3 h-3 mt-0.5 cursor-pointer"
                      style={{ accentColor: ACCENT }}
                    />
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-x-2">
                        {s.label}
                        {counts[s.key] !== undefined && (
                          <span style={{ color: ACCENT }}>{counts[s.key]} found</span>
                        )}
                      </span>
                      <span className="block text-muted-foreground/60">{s.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
              {!anyMode && (
                <span className="block text-xs text-warning">Select at least one source.</span>
              )}
            </div>

            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                size="sm"
                variant="ghost"
                className="gap-1.5 text-muted-foreground hover:text-foreground border border-border hover:bg-secondary"
                onClick={handleTestConnection}
                disabled={connectionStatus === 'testing' || importing}
              >
                {connectionStatus === 'testing'
                  ? <Loader2 size={13} className="animate-spin" />
                  : <CheckCircle2 size={13} />}
                Test Connection
              </Button>
              <Button
                size="sm"
                style={{ background: ACCENT, color: '#ffffff' }}
                className="gap-1.5"
                onClick={handleImport}
                disabled={!anyMode || importing || connectionStatus === 'testing'}
              >
                {importing ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                Import to Inventory
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground italic">
              Leave the client ID and secret blank to use the ones in the server .env (only sent to
              the OMADA_URL configured there). Everything lands in the device inventory as pending,
              to approve onto a canvas like any other discovery.
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2 shrink-0 pt-2 border-t border-border">
          <Button variant="ghost" onClick={handleClose}>Cancel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

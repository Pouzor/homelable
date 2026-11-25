import { useState } from 'react'
import { Waypoints, CheckCircle2, XCircle, Loader2, Download } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { tailscaleApi, type TailscaleConnection } from '@/api/client'
import { SOURCE_META } from '@/utils/deviceSources'
import { toast } from 'sonner'

const TAILSCALE_ACCENT = SOURCE_META.tailscale.color

type CredentialKind = 'oauth' | 'api_key'

interface TailscaleImportModalProps {
  open: boolean
  onClose: () => void
  onInventoryImported?: () => void
}

interface ConnectionForm {
  kind: CredentialKind
  client_id: string
  client_secret: string
  api_key: string
  tailnet: string
  tags: string
  include_shared: boolean
}

const DEFAULT_FORM: ConnectionForm = {
  kind: 'oauth',
  client_id: '',
  client_secret: '',
  api_key: '',
  tailnet: '',
  tags: '',
  include_shared: false,
}

/** "server, tag:nas" → ['server', 'tag:nas']; the backend adds a missing `tag:`. */
function parseTags(raw: string): string[] {
  return raw.split(',').map((t) => t.trim()).filter(Boolean)
}

export function TailscaleImportModal({ open, onClose, onInventoryImported }: TailscaleImportModalProps) {
  const [form, setForm] = useState<ConnectionForm>(DEFAULT_FORM)
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle')
  const [connectionMsg, setConnectionMsg] = useState('')
  const [importing, setImporting] = useState(false)

  const update = <K extends keyof ConnectionForm>(field: K, value: ConnectionForm[K]) =>
    setForm((f) => ({ ...f, [field]: value }))

  // Half an OAuth client is the one input the server cannot fall back from.
  const halfOauth =
    form.kind === 'oauth' && Boolean(form.client_id.trim()) !== Boolean(form.client_secret.trim())

  const buildPayload = (): TailscaleConnection => ({
    // Blank credentials fall back to the server env, like every other import.
    ...(form.kind === 'api_key'
      ? { api_key: form.api_key.trim() || undefined }
      : {
          oauth_client_id: form.client_id.trim() || undefined,
          oauth_client_secret: form.client_secret.trim() || undefined,
        }),
    tailnet: form.tailnet.trim() || undefined,
    include_shared: form.include_shared,
    tags: parseTags(form.tags),
  })

  const handleClose = () => {
    setForm(DEFAULT_FORM)
    setConnectionStatus('idle')
    setConnectionMsg('')
    onClose()
  }

  const handleTestConnection = async () => {
    if (halfOauth) { toast.error('Enter both the client id and the client secret'); return }
    setConnectionStatus('testing')
    try {
      const res = await tailscaleApi.testConnection(buildPayload())
      setConnectionStatus(res.data.connected ? 'ok' : 'fail')
      setConnectionMsg(res.data.message)
    } catch (e) {
      setConnectionStatus('fail')
      setConnectionMsg(e instanceof Error ? e.message : 'Connection failed')
    }
  }

  const handleImport = async () => {
    if (halfOauth) { toast.error('Enter both the client id and the client secret'); return }
    setImporting(true)
    try {
      const res = await tailscaleApi.importToPending(buildPayload())
      const { device_count, pending_created, pending_updated, online_count } = res.data
      toast.success(
        `Imported ${device_count} device(s), ${online_count} online — ` +
        `${pending_created} new, ${pending_updated} updated`,
      )
      onInventoryImported?.()
      handleClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Tailscale import failed')
    } finally {
      setImporting(false)
    }
  }

  const kindButton = (kind: CredentialKind, label: string) => (
    <button
      type="button"
      onClick={() => update('kind', kind)}
      aria-pressed={form.kind === kind}
      className={`px-2.5 py-1 text-xs transition-colors first:rounded-l-md last:rounded-r-md border border-border ${
        form.kind === kind ? 'text-foreground' : 'bg-background text-muted-foreground hover:text-foreground'
      }`}
      style={form.kind === kind ? { backgroundColor: `${TAILSCALE_ACCENT}33` } : undefined}
    >
      {label}
    </button>
  )

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="bg-popover border-border max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-foreground flex items-center gap-2">
            <Waypoints size={16} style={{ color: TAILSCALE_ACCENT }} />
            Tailscale Import
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-2 min-h-0">
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">Credential</span>
              <div className="flex">
                {kindButton('oauth', 'OAuth client')}
                {kindButton('api_key', 'API access token')}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              {form.kind === 'oauth' ? (
                <>
                  <div className="space-y-1">
                    <Label htmlFor="ts-client-id" className="text-xs text-muted-foreground">
                      Client ID (optional)
                    </Label>
                    <Input
                      id="ts-client-id"
                      value={form.client_id}
                      onChange={(e) => update('client_id', e.target.value)}
                      autoComplete="off"
                      className="font-mono text-sm bg-background border-border"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="ts-client-secret" className="text-xs text-muted-foreground">
                      Client secret (optional)
                    </Label>
                    <Input
                      id="ts-client-secret"
                      value={form.client_secret}
                      onChange={(e) => update('client_secret', e.target.value)}
                      placeholder="tskey-client-…"
                      type="password"
                      autoComplete="new-password"
                      className="font-mono text-sm bg-background border-border"
                    />
                  </div>
                  <p className="col-span-2 text-[11px] text-muted-foreground/60">
                    Create it under Settings → Trust credentials in the Tailscale admin console, with
                    only the <code className="font-mono">devices:core:read</code> scope. It cannot
                    change anything and does not expire.
                  </p>
                </>
              ) : (
                <>
                  <div className="col-span-2 space-y-1">
                    <Label htmlFor="ts-api-key" className="text-xs text-muted-foreground">
                      API access token (optional)
                    </Label>
                    <Input
                      id="ts-api-key"
                      value={form.api_key}
                      onChange={(e) => update('api_key', e.target.value)}
                      placeholder="tskey-api-…"
                      type="password"
                      autoComplete="new-password"
                      className="font-mono text-sm bg-background border-border"
                    />
                  </div>
                  <p className="col-span-2 text-[11px] text-muted-foreground/60">
                    An access token carries its owner&apos;s full rights and expires after at most
                    90 days. Prefer a read-only OAuth client.
                  </p>
                </>
              )}

              <div className="space-y-1">
                <Label htmlFor="ts-tailnet" className="text-xs text-muted-foreground">Tailnet</Label>
                <Input
                  id="ts-tailnet"
                  value={form.tailnet}
                  onChange={(e) => update('tailnet', e.target.value)}
                  placeholder="-"
                  className="font-mono text-sm bg-background border-border"
                />
                <p className="text-[11px] text-muted-foreground/60">Blank: the credential&apos;s own tailnet</p>
              </div>
              <div className="space-y-1">
                <Label htmlFor="ts-tags" className="text-xs text-muted-foreground">Only these tags (optional)</Label>
                <Input
                  id="ts-tags"
                  value={form.tags}
                  onChange={(e) => update('tags', e.target.value)}
                  placeholder="tag:server, tag:nas"
                  className="font-mono text-sm bg-background border-border"
                />
                <p className="text-[11px] text-muted-foreground/60">Blank imports every device</p>
              </div>

              <div className="col-span-2 pt-1">
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.include_shared}
                    onChange={(e) => update('include_shared', e.target.checked)}
                    className="w-3 h-3 cursor-pointer"
                    style={{ accentColor: TAILSCALE_ACCENT }}
                  />
                  Include devices shared in from other tailnets
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
                style={{ background: TAILSCALE_ACCENT, color: '#ffffff' }}
                className="gap-1.5"
                onClick={handleImport}
                disabled={importing || connectionStatus === 'testing'}
              >
                {importing ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                Import to Inventory
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground italic">
              Leave the credential blank to use the one in the server .env. Each device lands in the
              device inventory as pending with its tailnet address. Tailscale reports no MAC address,
              so a machine an IP scan also found is merged by hand once; later syncs keep it merged.
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

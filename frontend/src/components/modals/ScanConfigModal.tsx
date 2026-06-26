import { useState, useEffect } from 'react'
import { Plus, Trash2, Settings, ChevronRight, ChevronDown } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { scanApi, type DeepScanConfig } from '@/api/client'
import { toast } from 'sonner'

interface ScanConfigModalProps {
  open: boolean
  onClose: () => void
  onScanNow: () => void
}

const DEEP_DEFAULTS: DeepScanConfig = { http_ranges: [], http_probe_enabled: false, verify_tls: false }

export function ScanConfigModal({ open, onClose, onScanNow }: ScanConfigModalProps) {
  const [ranges, setRanges] = useState<string[]>([''])
  const [saving, setSaving] = useState(false)

  // Deep-scan section. Pre-filled from persisted defaults; edits here are a
  // per-scan override passed to trigger() — they do NOT change the saved defaults.
  const [deepOpen, setDeepOpen] = useState(false)
  const [deepDefaults, setDeepDefaults] = useState<DeepScanConfig>(DEEP_DEFAULTS)
  const [httpProbe, setHttpProbe] = useState(false)
  const [verifyTls, setVerifyTls] = useState(false)
  const [httpRangesText, setHttpRangesText] = useState('')

  useEffect(() => {
    if (!open) return
    scanApi.getConfig()
      .then((res) => {
        const d = res.data
        setRanges(d.ranges.length > 0 ? d.ranges : [''])
        const deep: DeepScanConfig = {
          http_ranges: d.http_ranges ?? [],
          http_probe_enabled: d.http_probe_enabled ?? false,
          verify_tls: d.verify_tls ?? false,
        }
        setDeepDefaults(deep)
        setHttpProbe(deep.http_probe_enabled)
        setVerifyTls(deep.verify_tls)
        setHttpRangesText(deep.http_ranges.join(', '))
        setDeepOpen(deep.http_probe_enabled || deep.http_ranges.length > 0)
      })
      .catch(() => {/* use defaults */})
  }, [open])

  const parseHttpRanges = () =>
    httpRangesText.split(',').map((r) => r.trim()).filter(Boolean)

  const handleScanNow = async () => {
    const cleaned = ranges.map((r) => r.trim()).filter(Boolean)
    if (cleaned.length === 0) { toast.error('Add at least one IP range'); return }
    setSaving(true)
    try {
      // Persist IP ranges; leave deep-scan defaults as configured in Options.
      await scanApi.saveConfig({ ranges: cleaned, ...deepDefaults })
      // Per-scan deep-scan override from this dialog.
      await scanApi.trigger({
        http_ranges: parseHttpRanges(),
        http_probe_enabled: httpProbe,
        verify_tls: verifyTls,
      })
      onScanNow()
      onClose()
    } catch {
      toast.error('Failed to start scan')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="bg-[#161b22] border-border max-w-md">
        <DialogHeader>
          <DialogTitle className="text-foreground">Scan Configuration</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* IP Ranges */}
          <div className="space-y-2">
            <Label className="text-sm text-muted-foreground">IP Ranges (CIDR)</Label>
            {ranges.map((r, i) => (
              <div key={i} className="flex gap-2">
                <Input
                  value={r}
                  onChange={(e) => {
                    const next = [...ranges]
                    next[i] = e.target.value
                    setRanges(next)
                  }}
                  placeholder="192.168.1.0/24"
                  className="font-mono text-sm bg-[#0d1117] border-border"
                />
                <Button
                  size="icon"
                  variant="ghost"
                  className="shrink-0 text-muted-foreground hover:text-[#f85149]"
                  onClick={() => setRanges(ranges.filter((_, j) => j !== i))}
                  disabled={ranges.length === 1}
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            ))}
            <Button
              size="sm"
              variant="ghost"
              className="gap-1.5 text-muted-foreground hover:text-foreground"
              onClick={() => setRanges([...ranges, ''])}
            >
              <Plus size={13} /> Add range
            </Button>
          </div>

          {/* Deep Scan (opt-in) */}
          <div className="space-y-2 border-t border-border pt-3">
            <button
              type="button"
              onClick={() => setDeepOpen((v) => !v)}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              {deepOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              Deep Scan
            </button>

            {deepOpen && (
              <div className="space-y-3 pl-1">
                <p className="text-xs text-muted-foreground">
                  Scan extra ports and probe HTTP services to identify apps on custom ports.
                  Overrides the saved defaults for this scan only.
                </p>

                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Extra port ranges</Label>
                  <Input
                    value={httpRangesText}
                    onChange={(e) => setHttpRangesText(e.target.value)}
                    placeholder="8000-8100, 9000-9100"
                    className="font-mono text-sm bg-[#0d1117] border-border"
                  />
                </div>

                <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={httpProbe}
                    onChange={(e) => setHttpProbe(e.target.checked)}
                    className="accent-[#00d4ff]"
                  />
                  Enable HTTP probe
                </label>

                <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={verifyTls}
                    onChange={(e) => setVerifyTls(e.target.checked)}
                    className="accent-[#00d4ff]"
                  />
                  Verify TLS certificates
                </label>
              </div>
            )}
          </div>

          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Settings size={11} />
            Status check interval can be configured in the sidebar Settings.
          </p>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            onClick={handleScanNow}
            disabled={saving}
            style={{ background: '#00d4ff', color: '#0d1117' }}
          >
            Scan Now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

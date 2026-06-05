import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { settingsApi } from '@/api/client'
import { useCanvasStore } from '@/stores/canvasStore'
import { toast } from 'sonner'
import {
  type AlignmentSettings,
  readAlignmentSettings,
  writeAlignmentSettings,
  subscribeAlignmentSettings,
} from '@/utils/alignmentSettings'

const STANDALONE = import.meta.env.VITE_STANDALONE === 'true'

interface SettingsModalProps {
  open: boolean
  onClose: () => void
}

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const [interval, setIntervalValue] = useState(60)
  const [saving, setSaving] = useState(false)
  const [alignment, setAlignment] = useState<AlignmentSettings>(readAlignmentSettings)
  const hideIp = useCanvasStore((s) => s.hideIp)
  const setHideIp = useCanvasStore((s) => s.setHideIp)

  useEffect(() => {
    if (!open || STANDALONE) return
    settingsApi.get()
      .then((res) => setIntervalValue(res.data.interval_seconds))
      .catch(() => {/* use default */})
  }, [open])

  useEffect(() => subscribeAlignmentSettings(setAlignment), [])

  const updateAlignment = (patch: Partial<AlignmentSettings>) => {
    const next = { ...alignment, ...patch }
    setAlignment(next)
    writeAlignmentSettings(next)
  }

  const handleSave = async () => {
    // Canvas prefs (alignment, hide-IP) persist on change; only the backend
    // status-check interval needs an API round-trip.
    if (STANDALONE) {
      onClose()
      return
    }
    setSaving(true)
    try {
      await settingsApi.save({ interval_seconds: interval })
      toast.success('Settings saved')
      onClose()
    } catch {
      toast.error('Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="bg-[#161b22] border-border max-w-md">
        <DialogHeader>
          <DialogTitle className="text-foreground">Settings</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Status checker */}
          {!STANDALONE && (
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Status check interval (s)</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={10}
                max={3600}
                value={interval}
                onChange={(e) => { const v = Number(e.target.value); if (!isNaN(v)) setIntervalValue(v) }}
                className="w-24 px-2 py-1 rounded-md text-xs font-mono bg-[#0d1117] border border-border text-foreground focus:outline-none focus:border-[#00d4ff]"
              />
              <span className="text-xs text-muted-foreground">seconds</span>
            </div>
            <p className="text-[10px] text-muted-foreground leading-tight">
              How often node health is polled (ping, HTTP, SSH…)
            </p>
          </div>
          )}

          {/* Canvas */}
          <div className="pt-3 border-t border-border space-y-3">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Canvas</span>

            <label className="flex items-center justify-between gap-2 cursor-pointer">
              <span className="text-xs text-foreground">Snap to nodes</span>
              <input
                type="checkbox"
                checked={alignment.enabled}
                onChange={(e) => updateAlignment({ enabled: e.target.checked })}
                className="cursor-pointer accent-[#00d4ff]"
                aria-label="Toggle alignment guides"
              />
            </label>

            <label className="flex items-center justify-between gap-2 cursor-pointer">
              <span className="text-xs text-foreground">Hide IP addresses</span>
              <input
                type="checkbox"
                checked={hideIp}
                onChange={(e) => setHideIp(e.target.checked)}
                className="cursor-pointer accent-[#00d4ff]"
                aria-label="Toggle IP address masking"
              />
            </label>

            <div className={alignment.enabled ? 'space-y-1.5' : 'space-y-1.5 opacity-50 pointer-events-none'}>
              <label className="text-xs text-muted-foreground">Snap distance</label>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={2}
                  max={16}
                  step={1}
                  value={alignment.threshold}
                  onChange={(e) => updateAlignment({ threshold: Number(e.target.value) })}
                  className="flex-1 cursor-pointer accent-[#00d4ff]"
                  aria-label="Alignment snap threshold"
                />
                <span className="font-mono text-[11px] text-foreground w-8 text-right">{alignment.threshold}px</span>
              </div>
              <p className="text-[10px] text-muted-foreground leading-tight">
                Distance at which dragged nodes snap to neighbours. Hold Alt while dragging to disable.
              </p>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            onClick={handleSave}
            disabled={saving}
            style={{ background: '#00d4ff', color: '#0d1117' }}
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

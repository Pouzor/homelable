import { useState, useEffect } from 'react'
import { Plus, Trash2, Settings } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { scanApi } from '@/api/client'
import { toast } from 'sonner'

interface ScanConfigModalProps {
  open: boolean
  onClose: () => void
  onScanNow: () => void
}

export function ScanConfigModal({ open, onClose, onScanNow }: ScanConfigModalProps) {
  const [ranges, setRanges] = useState<string[]>([''])
  const [interval, setInterval] = useState(60)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    scanApi.getConfig()
      .then((res) => {
        setRanges(res.data.ranges.length > 0 ? res.data.ranges : [''])
        setInterval(res.data.interval_seconds)
      })
      .catch(() => {/* use defaults */})
  }, [open])

  const handleSave = async () => {
    const cleaned = ranges.map((r) => r.trim()).filter(Boolean)
    if (cleaned.length === 0) { toast.error('Add at least one IP range'); return }
    setSaving(true)
    try {
      await scanApi.saveConfig({ ranges: cleaned, interval_seconds: interval })
      toast.success('Scan config saved')
      onClose()
    } catch {
      toast.error('Failed to save config')
    } finally {
      setSaving(false)
    }
  }

  const handleScanNow = async () => {
    const cleaned = ranges.map((r) => r.trim()).filter(Boolean)
    if (cleaned.length === 0) { toast.error('Add at least one IP range'); return }
    await handleSave()
    onScanNow()
    onClose()
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

          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Settings size={11} />
            Status check interval can be configured in the sidebar Settings.
          </p>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="outline" onClick={handleSave} disabled={saving}>Save</Button>
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

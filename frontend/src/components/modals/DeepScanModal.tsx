/**
 * Deep scan — pick what to sweep before starting one.
 *
 * The full 65535-port range is the default and the point of the feature
 * (issue #350), but it costs minutes per host. A user who already knows where
 * a service lives, or who only wants the low ports back, types a narrower spec
 * here instead of waiting for the whole range.
 */
import { useState } from 'react'
import { Radar } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { countPorts, isValidPortSpec, FULL_PORT_RANGE } from '@/utils/portSpec'
import modalStyles from './modal-interactive.module.css'

const PRESETS: Array<{ label: string; spec: string }> = [
  { label: 'All ports', spec: FULL_PORT_RANGE },
  { label: 'Well-known', spec: '1-1024' },
  { label: 'Common', spec: '1-10000' },
]

interface DeepScanModalProps {
  open: boolean
  target?: string | null
  onClose: () => void
  onStart: (ports: string) => void
}

export function DeepScanModal({ open, target, onClose, onStart }: DeepScanModalProps) {
  // Prefilled with the full range. The caller mounts this only while it is
  // open, so a previous narrow spec never becomes the next scan's default.
  const [spec, setSpec] = useState(FULL_PORT_RANGE)

  const trimmed = spec.trim()
  const valid = isValidPortSpec(trimmed)
  const total = countPorts(trimmed)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!valid) return
    onStart(trimmed)
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md bg-[#161b22] border-[#30363d]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Radar size={15} className="text-[#00d4ff]" />
            Deep scan{target ? ` — ${target}` : ''}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="deep-scan-ports" className="text-xs text-muted-foreground">
              Port range
            </Label>
            <Input
              id="deep-scan-ports"
              value={spec}
              onChange={(e) => setSpec(e.target.value)}
              autoFocus
              spellCheck={false}
              placeholder={FULL_PORT_RANGE}
              data-testid="deep-scan-ports"
              className="h-8 font-mono text-sm bg-[#21262d] border-[#30363d]"
            />
            <div className="flex items-center justify-between gap-2 text-[10px]">
              <span className="text-muted-foreground">
                A port, a range, or a comma list — <span className="font-mono">80,443,8000-9000</span>
              </span>
              {trimmed !== '' && (
                <span className={valid ? 'text-muted-foreground shrink-0' : 'text-[#f85149] shrink-0'}>
                  {valid ? `${total.toLocaleString('en-US')} ports` : 'Invalid range'}
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((preset) => (
              <button
                key={preset.spec}
                type="button"
                onClick={() => setSpec(preset.spec)}
                className={`px-2 py-1 text-[10px] border transition-colors cursor-pointer ${modalStyles['modal-radius']} ${
                  trimmed === preset.spec
                    ? 'border-[#00d4ff] text-[#00d4ff] bg-[#00d4ff]/10'
                    : 'border-[#30363d] text-muted-foreground hover:text-foreground'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>

          <p className="text-[10px] text-muted-foreground">
            Scanning runs in the background — the whole range takes several minutes. Found services are
            merged into the device; nothing already recorded is removed.
          </p>

          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={`cursor-pointer ${modalStyles['modal-cancel-hover']}`}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={!valid}
              data-testid="deep-scan-start"
              className="bg-[#00d4ff] text-[#0d1117] hover:bg-[#00d4ff]/90 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Start scan
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

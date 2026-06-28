import { useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  exportToPng,
  exportToSvg,
  EXPORT_QUALITY_OPTIONS,
  EXPORT_BACKGROUND_OPTIONS,
  type ExportQuality,
  type ExportFormat,
  type ExportBackground,
} from '@/utils/export'

interface ExportModalProps {
  open: boolean
  onClose: () => void
  getElement: () => HTMLElement | null
}

export function ExportModal({ open, onClose, getElement }: ExportModalProps) {
  const [quality, setQuality] = useState<ExportQuality>('high')
  const [format, setFormat] = useState<ExportFormat>('png')
  const [background, setBackground] = useState<ExportBackground>('dark')
  const [exporting, setExporting] = useState(false)

  const handleExport = async () => {
    const el = getElement()
    if (!el) return
    setExporting(true)
    try {
      if (format === 'svg') {
        await exportToSvg(el, background)
      } else {
        await exportToPng(el, quality, background)
      }
      onClose()
    } finally {
      setExporting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="bg-[#161b22] border-border max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-foreground">Export Canvas</DialogTitle>
        </DialogHeader>

        <div className="space-y-2 py-2">
          {EXPORT_QUALITY_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => { setFormat('png'); setQuality(opt.value) }}
              className={[
                'w-full flex items-center justify-between px-3 py-2.5 rounded-md border text-sm transition-colors',
                format === 'png' && quality === opt.value
                  ? 'border-[#00d4ff] bg-[#00d4ff10] text-foreground'
                  : 'border-border bg-[#0d1117] text-muted-foreground hover:border-muted-foreground',
              ].join(' ')}
            >
              <span className="font-medium">{opt.label}</span>
              <span className="text-xs opacity-70">{opt.hint}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => setFormat('svg')}
            className={[
              'w-full flex items-center justify-between px-3 py-2.5 rounded-md border text-sm transition-colors',
              format === 'svg'
                ? 'border-[#00d4ff] bg-[#00d4ff10] text-foreground'
                : 'border-border bg-[#0d1117] text-muted-foreground hover:border-muted-foreground',
            ].join(' ')}
          >
            <span className="font-medium">SVG</span>
            <span className="text-xs opacity-70">vector — scalable, small file</span>
          </button>
        </div>

        <div className="space-y-1.5 pb-2">
          <p className="text-xs font-medium text-muted-foreground">Background</p>
          <div className="flex gap-2">
            {EXPORT_BACKGROUND_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setBackground(opt.value)}
                className={[
                  'flex-1 flex items-center gap-2 px-3 py-2 rounded-md border text-sm transition-colors',
                  background === opt.value
                    ? 'border-[#00d4ff] bg-[#00d4ff10] text-foreground'
                    : 'border-border bg-[#0d1117] text-muted-foreground hover:border-muted-foreground',
                ].join(' ')}
              >
                <span
                  className="h-3.5 w-3.5 rounded-sm border border-border"
                  style={{ background: opt.color }}
                />
                <span className="font-medium">{opt.label}</span>
                <span className="text-xs opacity-70">{opt.hint}</span>
              </button>
            ))}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose} disabled={exporting}>Cancel</Button>
          <Button
            onClick={handleExport}
            disabled={exporting}
            style={{ background: '#00d4ff', color: '#0d1117' }}
          >
            {exporting
              ? <><Loader2 size={14} className="animate-spin mr-1.5" />Exporting…</>
              : <><Download size={14} className="mr-1.5" />Download</>
            }
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

import { useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { exportToPng, EXPORT_QUALITY_OPTIONS, type ExportQuality } from '@/utils/export'
import { exportCanvasToBase64 } from '@/utils/exportCanvas'
import { useCanvasStore } from '@/stores/canvasStore'
import { serializeNode, serializeEdge } from '@/utils/canvasSerializer'
import { toast } from 'sonner'

interface ExportModalProps {
  open: boolean
  onClose: () => void
  getElement: () => HTMLElement | null
}

export function ExportModal({ open, onClose, getElement }: ExportModalProps) {
  const [quality, setQuality] = useState<ExportQuality>('high')
  const [exporting, setExporting] = useState(false)
  const nodes = useCanvasStore((s) => s.nodes)
  const edges = useCanvasStore((s) => s.edges)

  const handleExport = async () => {
    const el = getElement()
    if (!el) return
    setExporting(true)
    try {
      await exportToPng(el, quality)
      onClose()
    } finally {
      setExporting(false)
    }
  }

  const handleExportBase64 = async () => {
    const nodesPayload = nodes.map(serializeNode)
    const edgesPayload = edges.map(serializeEdge)
    const payload = {
      schema_version: 1,
      canvas: {
        nodes: nodesPayload,
        edges: edgesPayload,
        meta: { label: 'Canvas Export', created_at: new Date().toISOString() },
      },
    }
    const b64 = exportCanvasToBase64(payload)
    try {
      await navigator.clipboard.writeText(b64)
      toast.success('Copied Base64 to clipboard')
    } catch (err) {
      toast.error('Failed to copy Base64 to clipboard')
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="bg-[#161b22] border-border max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-foreground">Export as PNG</DialogTitle>
        </DialogHeader>

        <div className="space-y-2 py-2">
          {EXPORT_QUALITY_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setQuality(opt.value)}
              className={[
                'w-full flex items-center justify-between px-3 py-2.5 rounded-md border text-sm transition-colors',
                quality === opt.value
                  ? 'border-[#00d4ff] bg-[#00d4ff10] text-foreground'
                  : 'border-border bg-[#0d1117] text-muted-foreground hover:border-muted-foreground',
              ].join(' ')}
            >
              <span className="font-medium">{opt.label}</span>
              <span className="text-xs opacity-70">{opt.hint}</span>
            </button>
          ))}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose} disabled={exporting}>Cancel</Button>
          <Button variant="outline" onClick={handleExportBase64} disabled={exporting}>Copy as Base64</Button>
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

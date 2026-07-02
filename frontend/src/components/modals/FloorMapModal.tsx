import { useState, useRef } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { FloorMapConfig } from '@/types'

interface FloorMapModalProps {
  open: boolean
  onClose: () => void
  onSubmit: (config: FloorMapConfig) => void
  onRemove: () => void
  initial: FloorMapConfig | null
}

export function FloorMapModal({ open, onClose, onSubmit, onRemove, initial }: FloorMapModalProps) {
  const [imageData, setImageData] = useState(initial?.imageData ?? '')
  const [width, setWidth] = useState(initial?.width ?? 800)
  const [height, setHeight] = useState(initial?.height ?? 600)
  const [opacity, setOpacity] = useState(initial?.opacity ?? 0.8)
  const [locked, setLocked] = useState(initial?.locked ?? false)
  const [enabled, setEnabled] = useState(initial?.enabled ?? true)
  const fileRef = useRef<HTMLInputElement>(null)

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string
      setImageData(dataUrl)
      const img = new Image()
      img.onload = () => {
        setWidth(img.naturalWidth)
        setHeight(img.naturalHeight)
      }
      img.src = dataUrl
    }
    reader.readAsDataURL(file)
  }

  const handleSubmit = () => {
    if (!imageData) return
    onSubmit({
      imageData,
      posX: initial?.posX ?? 0,
      posY: initial?.posY ?? 0,
      width,
      height,
      opacity,
      locked,
      enabled,
    })
  }

  const hasImage = !!imageData

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? 'Edit Floor Plan' : 'Import Floor Plan'}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          {!hasImage ? (
            <div
              className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-[#30363d] rounded-lg p-8 cursor-pointer hover:border-[#00d4ff]/50 transition-colors"
              onClick={() => fileRef.current?.click()}
            >
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleFile} />
              <span className="text-muted-foreground text-sm">Click to select a floor plan image</span>
              <span className="text-muted-foreground/50 text-xs">PNG, JPEG or WebP</span>
            </div>
          ) : (
            <>
              <div className="relative rounded-lg overflow-hidden border border-[#30363d]" style={{ maxHeight: 200 }}>
                <img src={imageData} alt="Floor plan preview" className="w-full h-full object-contain" style={{ opacity }} />
              </div>

              <div className="flex items-center gap-2">
                <Button size="sm" variant="secondary" className="cursor-pointer" onClick={() => fileRef.current?.click()}>
                  Replace Image
                </Button>
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image.webp" className="hidden" onChange={handleFile} />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs text-muted-foreground">Width (px)</Label>
                  <Input type="number" value={width} onChange={(e) => setWidth(Math.max(80, Number(e.target.value)))} className="bg-[#21262d] border-[#30363d] text-xs h-8" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs text-muted-foreground">Height (px)</Label>
                  <Input type="number" value={height} onChange={(e) => setHeight(Math.max(80, Number(e.target.value)))} className="bg-[#21262d] border-[#30363d] text-xs h-8" />
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label className="text-xs text-muted-foreground">Opacity: {Math.round(opacity * 100)}%</Label>
                <input
                  type="range" min="0.05" max="1" step="0.05" value={opacity}
                  onChange={(e) => setOpacity(Number(e.target.value))}
                  className="w-full accent-[#00d4ff]"
                />
              </div>

              <div className="flex items-center gap-6">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={locked} onChange={(e) => setLocked(e.target.checked)} className="accent-[#00d4ff] w-3.5 h-3.5" />
                  <span className="text-xs text-muted-foreground">Lock position & size</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="accent-[#00d4ff] w-3.5 h-3.5" />
                  <span className="text-xs text-muted-foreground">Show on canvas</span>
                </label>
              </div>
            </>
          )}
        </div>

        <DialogFooter className="flex items-center justify-between sm:justify-between">
          {hasImage && initial && (
            <Button size="sm" variant="destructive" className="cursor-pointer" onClick={onRemove}>
              Remove
            </Button>
          )}
          <div className="flex gap-2 ml-auto">
            <Button size="sm" variant="ghost" className="cursor-pointer" onClick={onClose}>Cancel</Button>
            <Button size="sm" className="bg-[#00d4ff] text-[#0d1117] hover:bg-[#00d4ff]/90 cursor-pointer" disabled={!hasImage} onClick={handleSubmit}>
              {initial ? 'Apply' : 'Import'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

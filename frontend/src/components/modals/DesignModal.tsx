import { useRef, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { DESIGN_ICONS, DEFAULT_DESIGN_ICON, resolveDesignIcon } from '@/utils/designIcons'
import type { Design, DesignType, FloorMapConfig } from '@/types'
import { resolveServerPath } from '@/utils/basePath'

/** Canvas kinds offered on create. `electrical` shares the network renderer. */
const CANVAS_KINDS: { value: DesignType; label: string; hint: string }[] = [
  { value: 'network', label: 'Diagram', hint: 'Nodes and links on a free canvas' },
  { value: 'rack', label: 'Rack', hint: 'Racks, mounted gear and patching' },
]

export interface DesignFormData {
  name: string
  icon: string
  /**
   * Kind of canvas to create. Only offered in create mode — a canvas cannot
   * change kind afterwards, since network and rack store different things.
   */
  designType?: DesignType
  /**
   * Floor plan for THIS canvas. Only present when the floor-plan section is
   * shown (edit mode on the active canvas). `null` means "remove the floor
   * plan"; `undefined` means "leave it untouched".
   */
  floorMap?: FloorMapConfig | null
  /**
   * When set, create the new canvas by deep-copying this existing design instead
   * of starting blank. Only offered in create mode with `sourceDesigns` present.
   */
  sourceId?: string
}

interface DesignModalProps {
  open: boolean
  onClose: () => void
  onSubmit: (data: DesignFormData) => void
  initial?: DesignFormData
  title?: string
  submitLabel?: string
  /** Show the floor-plan section (only meaningful when editing the active canvas). */
  showFloorMap?: boolean
  /** Current floor plan of the canvas being edited (position preserved on save). */
  initialFloorMap?: FloorMapConfig | null
  /**
   * Upload a selected image and resolve to its server URL. Required whenever
   * the floor-plan section is shown — images are stored server-side, never as
   * base64. Rejects on failure (caller surfaces the error).
   */
  onUploadImage?: (file: File) => Promise<string>
  /**
   * Existing designs offered as a copy source (create mode only). When non-empty,
   * a "Copy from existing" option appears; choosing it clones the picked canvas.
   */
  sourceDesigns?: Design[]
}

export function DesignModal({
  open,
  onClose,
  onSubmit,
  initial,
  title = 'New Canvas',
  submitLabel = 'Create',
  showFloorMap = false,
  initialFloorMap = null,
  onUploadImage,
  sourceDesigns = [],
}: DesignModalProps) {
  const [name, setName] = useState(initial?.name ?? '')
  const [icon, setIcon] = useState(initial?.icon ?? DEFAULT_DESIGN_ICON)
  const [designType, setDesignType] = useState<DesignType>(initial?.designType ?? 'network')

  // "Copy from existing" is create-mode only (no floor-plan section shown).
  const canCopy = !showFloorMap && sourceDesigns.length > 0
  // Editing never changes the kind; `initial` is only passed in edit mode.
  const canPickKind = !initial && !showFloorMap
  const [fromExisting, setFromExisting] = useState(false)
  const [sourceId, setSourceId] = useState<string>(sourceDesigns[0]?.id ?? '')

  // Floor plan state (only used when showFloorMap)
  const [imageData, setImageData] = useState(initialFloorMap?.imageData ?? '')
  const [width, setWidth] = useState(initialFloorMap?.width ?? 800)
  const [height, setHeight] = useState(initialFloorMap?.height ?? 600)
  const [opacity, setOpacity] = useState(initialFloorMap?.opacity ?? 0.8)
  const [locked, setLocked] = useState(initialFloorMap?.locked ?? false)
  const [enabled, setEnabled] = useState(initialFloorMap?.enabled ?? true)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''  // allow re-selecting the same file after a failure
    if (!file || !onUploadImage) return
    setUploading(true)
    try {
      const url = await onUploadImage(file)
      setImageData(url)
      // Read natural dimensions from the served image (non-blocking).
      const img = new Image()
      img.onload = () => {
        setWidth(img.naturalWidth)
        setHeight(img.naturalHeight)
      }
      img.src = url
    } catch {
      // Caller surfaces the error toast; leave existing state untouched.
    } finally {
      setUploading(false)
    }
  }

  const handleSubmit = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    if (canCopy && fromExisting && !sourceId) return
    const data: DesignFormData = { name: trimmed, icon }
    if (canPickKind) data.designType = designType
    if (canCopy && fromExisting && sourceId) {
      data.sourceId = sourceId
    }
    if (showFloorMap) {
      data.floorMap = imageData
        ? {
            imageData,
            // Preserve position from the existing config; new plans start at 0,0.
            posX: initialFloorMap?.posX ?? 0,
            posY: initialFloorMap?.posY ?? 0,
            width,
            height,
            opacity,
            locked,
            enabled,
          }
        : null
    }
    onSubmit(data)
  }

  const hasImage = !!imageData

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="design-name">Name</Label>
            <Input
              id="design-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit() }}
              placeholder="e.g. Home Network, Rack Power"
              autoFocus
            />
          </div>

          {/* A copy inherits the source's kind, so the picker would be a lie. */}
          {canPickKind && !fromExisting && (
            <div className="space-y-1.5">
              <Label>Kind</Label>
              <div className="grid grid-cols-2 gap-1.5">
                {CANVAS_KINDS.map((kind) => {
                  const selected = kind.value === designType
                  return (
                    <button
                      key={kind.value}
                      type="button"
                      aria-pressed={selected}
                      title={kind.hint}
                      onClick={() => setDesignType(kind.value)}
                      className={`rounded-md border px-2 py-2 text-left transition-colors cursor-pointer ${
                        selected
                          ? 'border-[#00d4ff] bg-[#00d4ff]/10 text-[#00d4ff]'
                          : 'border-border text-muted-foreground hover:text-foreground hover:border-[#30363d]'
                      }`}
                    >
                      <span className="block text-xs font-medium">{kind.label}</span>
                      <span className="block text-[10px] leading-tight opacity-70">{kind.hint}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Icon</Label>
            <div className="grid grid-cols-8 gap-1.5">
              {DESIGN_ICONS.map((entry) => {
                const Icon = entry.icon
                const selected = entry.key === icon
                return (
                  <button
                    key={entry.key}
                    type="button"
                    aria-label={entry.label}
                    aria-pressed={selected}
                    title={entry.label}
                    onClick={() => setIcon(entry.key)}
                    className={`flex items-center justify-center aspect-square rounded-md border transition-colors cursor-pointer ${
                      selected
                        ? 'border-[#00d4ff] bg-[#00d4ff]/10 text-[#00d4ff]'
                        : 'border-border text-muted-foreground hover:text-foreground hover:border-[#30363d]'
                    }`}
                  >
                    <Icon size={16} />
                  </button>
                )
              })}
            </div>
          </div>

          {canCopy && (
            <div className="space-y-2 pt-2 border-t border-border">
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  aria-pressed={!fromExisting}
                  onClick={() => setFromExisting(false)}
                  className={`text-xs rounded-md border py-2 transition-colors cursor-pointer ${
                    !fromExisting
                      ? 'border-[#00d4ff] bg-[#00d4ff]/10 text-[#00d4ff]'
                      : 'border-border text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Blank canvas
                </button>
                <button
                  type="button"
                  aria-pressed={fromExisting}
                  onClick={() => setFromExisting(true)}
                  className={`text-xs rounded-md border py-2 transition-colors cursor-pointer ${
                    fromExisting
                      ? 'border-[#00d4ff] bg-[#00d4ff]/10 text-[#00d4ff]'
                      : 'border-border text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Copy from existing
                </button>
              </div>

              {fromExisting && (
                <div className="space-y-1 max-h-48 overflow-y-auto pr-1" role="radiogroup" aria-label="Source canvas">
                  {sourceDesigns.map((d) => {
                    const Icon = resolveDesignIcon(d.icon)
                    const selected = d.id === sourceId
                    return (
                      <button
                        key={d.id}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => setSourceId(d.id)}
                        className={`w-full flex items-center gap-2.5 rounded-md border px-2.5 py-2 text-left transition-colors cursor-pointer ${
                          selected
                            ? 'border-[#00d4ff] bg-[#00d4ff]/10'
                            : 'border-border hover:border-[#30363d]'
                        }`}
                      >
                        <Icon size={16} className={selected ? 'text-[#00d4ff]' : 'text-muted-foreground'} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm">{d.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {d.node_count ?? 0} nodes · {d.group_count ?? 0} groups · {d.text_count ?? 0} text
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {showFloorMap && (
            <div className="space-y-2 pt-2 border-t border-border">
              <Label>Floor Plan</Label>
              {!hasImage ? (
                <div
                  className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-[#30363d] rounded-lg p-6 cursor-pointer hover:border-[#00d4ff]/50 transition-colors"
                  onClick={() => fileRef.current?.click()}
                >
                  <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleFile} />
                  <span className="text-muted-foreground text-sm">{uploading ? 'Uploading…' : 'Click to select a floor plan image'}</span>
                  <span className="text-muted-foreground/50 text-xs">PNG, JPEG or WebP · max 10 MB</span>
                </div>
              ) : (
                <>
                  <div className="relative rounded-lg overflow-hidden border border-[#30363d]" style={{ maxHeight: 160 }}>
                    <img src={resolveServerPath(imageData)} alt="Floor plan preview" className="w-full h-full object-contain" style={{ opacity }} />
                  </div>

                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="secondary" className="cursor-pointer" disabled={uploading} onClick={() => fileRef.current?.click()}>
                      {uploading ? 'Uploading…' : 'Replace Image'}
                    </Button>
                    <Button size="sm" variant="destructive" className="cursor-pointer" onClick={() => setImageData('')}>
                      Remove
                    </Button>
                    <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleFile} />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
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
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!name.trim()}>{submitLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

import { useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { EDGE_TYPE_LABELS, type EdgeData, type EdgePathStyle, type EdgeType } from '@/types'
import { EDGE_DEFAULT_COLORS } from '@/utils/edgeColors'

const EDGE_TYPES = Object.entries(EDGE_TYPE_LABELS) as [EdgeType, string][]

type AnimMode = 'none' | 'basic' | 'snake' | 'flow'

function toAnimMode(v: EdgeData['animated']): AnimMode {
  if (v === true || v === 'snake') return 'snake'
  if (v === 'flow') return 'flow'
  if (v === 'basic') return 'basic'
  return 'none'
}

interface EdgeModalProps {
  open: boolean
  onClose: () => void
  onSubmit: (data: EdgeData) => void
  onDelete?: () => void
  onClearWaypoints?: () => void
  initial?: Partial<EdgeData>
  title?: string
}

export function EdgeModal({ open, onClose, onSubmit, onDelete, onClearWaypoints, initial, title = 'Connect Nodes' }: EdgeModalProps) {
  const [type, setType] = useState<EdgeType>(initial?.type ?? 'ethernet')
  const [label, setLabel] = useState(initial?.label ?? '')
  const [vlanId, setVlanId] = useState(initial?.vlan_id?.toString() ?? '')
  const [customColor, setCustomColor] = useState<string | undefined>(initial?.custom_color)
  const [pathStyle, setPathStyle] = useState<EdgePathStyle>(initial?.path_style ?? 'bezier')
  const [animation, setAnimation] = useState<AnimMode>(() => toAnimMode(initial?.animated))

  const effectiveColor = customColor ?? EDGE_DEFAULT_COLORS[type]

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSubmit({
      type,
      label: label || undefined,
      vlan_id: type === 'vlan' && vlanId ? parseInt(vlanId) : undefined,
      custom_color: customColor,
      path_style: pathStyle,
      animated: animation !== 'none' ? animation : undefined,
    })
    onClose()
  }

  const handleDelete = () => {
    onDelete?.()
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-[#161b22] border-[#30363d] text-foreground max-w-xs">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold">{title}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3 mt-2">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">Link Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as EdgeType)}>
              <SelectTrigger className="bg-[#21262d] border-[#30363d] text-sm h-8">
                <SelectValue>{EDGE_TYPE_LABELS[type]}</SelectValue>
              </SelectTrigger>
              <SelectContent className="bg-[#21262d] border-[#30363d]">
                {EDGE_TYPES.map(([value, label]) => (
                  <SelectItem key={value} value={value} className="text-sm">{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {type === 'vlan' && (
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">VLAN ID</Label>
              <Input
                type="number"
                min={1}
                max={4094}
                value={vlanId}
                onChange={(e) => setVlanId(e.target.value)}
                placeholder="e.g. 20"
                className="bg-[#21262d] border-[#30363d] font-mono text-sm h-8"
              />
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">Label <span className="text-muted-foreground/50">(optional)</span></Label>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. 1G, trunk..."
              className="bg-[#21262d] border-[#30363d] text-sm h-8"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">Path Style</Label>
            <div className="flex rounded-md overflow-hidden border border-[#30363d]">
              {(['bezier', 'smooth'] as EdgePathStyle[]).map((style) => (
                <button
                  key={style}
                  type="button"
                  onClick={() => setPathStyle(style)}
                  className="flex-1 py-1 text-xs capitalize transition-colors"
                  style={{
                    background: pathStyle === style ? '#00d4ff22' : '#21262d',
                    color: pathStyle === style ? '#00d4ff' : '#8b949e',
                    borderRight: style === 'bezier' ? '1px solid #30363d' : undefined,
                  }}
                >
                  {style === 'bezier' ? 'Bezier' : 'Smooth step'}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">Animation</Label>
            <div className="flex rounded-md overflow-hidden border border-[#30363d]">
              {(['none', 'basic', 'snake', 'flow'] as AnimMode[]).map((mode, i) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setAnimation(mode)}
                  className="flex-1 py-1 text-xs capitalize transition-colors"
                  style={{
                    background: animation === mode ? '#00d4ff22' : '#21262d',
                    color: animation === mode ? '#00d4ff' : '#8b949e',
                    borderRight: i < 3 ? '1px solid #30363d' : undefined,
                  }}
                >
                  {mode === 'none' ? 'None' : mode === 'basic' ? 'Basic' : mode === 'snake' ? 'Snake' : 'Flow'}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">Color</Label>
              {customColor && (
                <button
                  type="button"
                  onClick={() => setCustomColor(undefined)}
                  className="flex items-center gap-1 text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
                >
                  <RotateCcw size={10} /> Reset
                </button>
              )}
            </div>
            <label
              className="relative flex items-center gap-2.5 px-2.5 h-8 rounded-md border cursor-pointer"
              style={{ borderColor: customColor ? effectiveColor : '#30363d', background: '#21262d' }}
            >
              <input
                type="color"
                value={effectiveColor}
                onChange={(e) => setCustomColor(e.target.value)}
                className="absolute opacity-0 w-0 h-0"
              />
              <div className="w-4 h-4 rounded-sm shrink-0 border border-white/10" style={{ background: effectiveColor }} />
              <span className="font-mono text-xs" style={{ color: customColor ? effectiveColor : '#8b949e' }}>
                {effectiveColor}
              </span>
              {!customColor && <span className="text-[10px] text-muted-foreground/50 ml-auto">default</span>}
            </label>
          </div>

          {onClearWaypoints && initial?.waypoints && initial.waypoints.length > 0 && (
            <button
              type="button"
              onClick={() => { onClearWaypoints(); onClose() }}
              className="text-[10px] text-muted-foreground hover:text-[#e3b341] transition-colors text-left"
            >
              Clear path ({initial.waypoints.length} point{initial.waypoints.length !== 1 ? 's' : ''})
            </button>
          )}

          <div className="flex justify-between gap-2 pt-1">
            {onDelete ? (
              <Button type="button" variant="ghost" size="sm" className="bg-[#f85149]/10 text-[#f85149] hover:bg-[#f85149]/20 hover:text-[#f85149]" onClick={handleDelete}>
                Delete
              </Button>
            ) : <span />}
            <div className="flex gap-2">
              <Button type="button" variant="ghost" size="sm" className="bg-[#f85149]/10 text-[#f85149] hover:bg-[#f85149]/20 hover:text-[#f85149]" onClick={onClose}>Cancel</Button>
              <Button type="submit" size="sm" className="bg-[#238636]/20 text-[#3fb950] hover:bg-[#238636]/30">
                {onDelete ? 'Save' : 'Connect'}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { BorderStyle } from './GroupRectModal'

const BORDER_STYLES: { value: BorderStyle; label: string; preview: string }[] = [
  { value: 'solid',  label: 'Solid',  preview: '───' },
  { value: 'dashed', label: 'Dashed', preview: '╌╌╌' },
  { value: 'dotted', label: 'Dotted', preview: '···' },
  { value: 'double', label: 'Double', preview: '═══' },
  { value: 'none',   label: 'None',   preview: '   ' },
]

const BORDER_WIDTHS: { value: number; label: string }[] = [
  { value: 1, label: '1px' },
  { value: 2, label: '2px' },
  { value: 3, label: '3px' },
  { value: 4, label: '4px' },
  { value: 5, label: '5px' },
]

export interface GroupNodeFormData {
  label: string
  border_color: string
  border_style: BorderStyle
  border_width: number
  background_color: string
  z_order: number
  show_border: boolean
  parent_id?: string
}

const DEFAULT_FORM: GroupNodeFormData = {
  label: '',
  border_color: '#00d4ff',
  border_style: 'dashed',
  border_width: 2,
  background_color: '#21262d',
  z_order: 5,
  show_border: true,
  parent_id: undefined,
}

interface GroupNodeModalProps {
  open: boolean
  onClose: () => void
  onSubmit: (data: GroupNodeFormData) => void
  onDelete?: () => void
  initial?: Partial<GroupNodeFormData>
  title?: string
  containerNodes?: { id: string; label: string }[]
}

export function GroupNodeModal({
  open,
  onClose,
  onSubmit,
  onDelete,
  initial,
  title = 'Edit Group',
  containerNodes = [],
}: GroupNodeModalProps) {
  const [form, setForm] = useState<GroupNodeFormData>({ ...DEFAULT_FORM, ...initial })

  const set = <K extends keyof GroupNodeFormData>(key: K, value: GroupNodeFormData[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSubmit(form)
    onClose()
  }

  const selectedParentLabel =
    containerNodes.find((n) => n.id === form.parent_id)?.label ?? 'None (Standalone)'

  const colorFields: { key: 'border_color' | 'background_color'; label: string }[] = [
    { key: 'border_color',     label: 'Border'     },
    { key: 'background_color', label: 'Background' },
  ]

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-[#161b22] border-[#30363d] text-foreground max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold">{title}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 mt-2">
          {/* Label */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">Label</Label>
            <Input
              value={form.label}
              onChange={(e) => set('label', e.target.value)}
              placeholder="Group name…"
              className="bg-[#21262d] border-[#30363d] text-sm h-8"
            />
          </div>

          {/* Colors */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">Colors</Label>
            <div className="grid grid-cols-2 gap-2">
              {colorFields.map(({ key, label }) => (
                <div key={key} className="flex flex-col gap-1 items-center">
                  <label
                    className="relative w-full h-7 rounded-md border cursor-pointer overflow-hidden"
                    style={{ borderColor: '#30363d' }}
                  >
                    <input
                      type="color"
                      value={form[key].startsWith('#') ? form[key].slice(0, 7) : '#21262d'}
                      onChange={(e) => set(key, e.target.value)}
                      className="absolute inset-0 w-full h-full cursor-pointer opacity-0"
                    />
                    <div className="w-full h-full rounded-sm" style={{ background: form[key] }} />
                  </label>
                  <span className="text-[9px] text-muted-foreground/60">{label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Border style */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">Border Style</Label>
            <div className="grid grid-cols-5 gap-1">
              {BORDER_STYLES.map(({ value, label, preview }) => {
                const isSelected = form.border_style === value
                return (
                  <button
                    key={value}
                    type="button"
                    title={label}
                    onClick={() => set('border_style', value)}
                    className="flex flex-col items-center justify-center h-10 rounded text-xs gap-0.5 transition-colors"
                    style={{
                      background: isSelected ? '#00d4ff22' : '#21262d',
                      border: `1px solid ${isSelected ? '#00d4ff88' : '#30363d'}`,
                      color: isSelected ? '#00d4ff' : '#8b949e',
                    }}
                  >
                    <span className="font-mono text-[11px] leading-none">{preview}</span>
                    <span className="text-[9px]">{label}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Border width */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">Border Width</Label>
            <div className="grid grid-cols-5 gap-1">
              {BORDER_WIDTHS.map(({ value, label }) => {
                const isSelected = form.border_width === value
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => set('border_width', value)}
                    className="flex items-center justify-center h-8 rounded text-xs transition-colors"
                    style={{
                      background: isSelected ? '#00d4ff22' : '#21262d',
                      border: `1px solid ${isSelected ? '#00d4ff88' : '#30363d'}`,
                      color: isSelected ? '#00d4ff' : '#8b949e',
                    }}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Show border */}
          <div className="flex items-center justify-between py-0.5">
            <div className="flex flex-col gap-0.5">
              <Label className="text-xs text-muted-foreground">Show Border</Label>
              <span className="text-[10px] text-muted-foreground/60">Hide border when not selected</span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={form.show_border}
              onClick={() => set('show_border', !form.show_border)}
              className="relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus:outline-none"
              style={{ background: form.show_border ? '#00d4ff' : '#30363d' }}
            >
              <span
                className="pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform"
                style={{ transform: form.show_border ? 'translateX(16px)' : 'translateX(0)' }}
              />
            </button>
          </div>

          {/* Parent container */}
          {containerNodes.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">Parent Container</Label>
              <Select
                value={form.parent_id ?? 'none'}
                onValueChange={(v) => set('parent_id', v === 'none' ? undefined : v)}
              >
                <SelectTrigger className="bg-[#21262d] border-[#30363d] text-sm h-8">
                  <SelectValue>{selectedParentLabel}</SelectValue>
                </SelectTrigger>
                <SelectContent className="bg-[#21262d] border-[#30363d]">
                  <SelectItem value="none" className="text-sm">None (Standalone)</SelectItem>
                  {containerNodes.map((n) => (
                    <SelectItem key={n.id} value={n.id} className="text-sm">{n.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Z-order / Layer */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">Layer (1 = back, 9 = front)</Label>
            <Select
              value={String(form.z_order)}
              onValueChange={(v) => set('z_order', Number(v))}
            >
              <SelectTrigger className="bg-[#21262d] border-[#30363d] text-sm h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-[#21262d] border-[#30363d]">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                  <SelectItem key={n} value={String(n)} className="text-sm">
                    {n}{n === 5 ? ' (default)' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Actions */}
          <div className="flex justify-between gap-2 pt-1">
            {onDelete ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="bg-[#f85149]/10 text-[#f85149] hover:bg-[#f85149]/20 hover:text-[#f85149]"
                onClick={() => { onDelete(); onClose() }}
              >
                Delete
              </Button>
            ) : <span />}
            <div className="flex gap-2">
              <Button type="button" variant="ghost" size="sm" className="bg-[#f85149]/10 text-[#f85149] hover:bg-[#f85149]/20 hover:text-[#f85149]" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" size="sm" className="bg-[#238636]/20 text-[#3fb950] hover:bg-[#238636]/30">
                Save
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { TextPosition } from '@/types'
import { hexToRgba, rgbaToHex8 } from '@/utils/colorUtils'

export type BorderStyle = 'solid' | 'dashed' | 'dotted' | 'double' | 'none'

export type LabelPosition = 'inside' | 'outside'

export interface GroupRectFormData {
  label: string
  font: string
  text_color: string
  text_position: TextPosition
  text_size: number
  label_position: LabelPosition
  border_color: string
  border_style: BorderStyle
  border_width: number
  background_color: string
  z_order: number
}

const BORDER_STYLES: { value: BorderStyle; label: string; preview: string }[] = [
  { value: 'solid',  label: 'Solid',  preview: '───' },
  { value: 'dashed', label: 'Dashed', preview: '╌╌╌' },
  { value: 'dotted', label: 'Dotted', preview: '···' },
  { value: 'double', label: 'Double', preview: '═══' },
  { value: 'none',   label: 'None',   preview: '   ' },
]

const TEXT_SIZES: { value: number; label: string }[] = [
  { value: 10, label: '10' },
  { value: 12, label: '12' },
  { value: 14, label: '14' },
  { value: 16, label: '16' },
  { value: 18, label: '18' },
  { value: 20, label: '20' },
]

const LABEL_POSITIONS: { value: LabelPosition; label: string }[] = [
  { value: 'inside',  label: 'Inside' },
  { value: 'outside', label: 'Outside' },
]

const BORDER_WIDTHS: { value: number; label: string }[] = [
  { value: 1, label: '1px' },
  { value: 2, label: '2px' },
  { value: 3, label: '3px' },
  { value: 4, label: '4px' },
  { value: 5, label: '5px' },
]

const DEFAULT_FORM: GroupRectFormData = {
  label: '',
  font: 'inter',
  text_color: '#e6edf3',
  text_position: 'top-left',
  text_size: 12,
  label_position: 'inside',
  border_color: '#00d4ff',
  border_style: 'solid',
  border_width: 2,
  background_color: '#00d4ff0d',
  z_order: 1,
}

const FONTS = [
  { value: 'inter', label: 'Inter (sans-serif)' },
  { value: 'mono', label: 'JetBrains Mono' },
  { value: 'serif', label: 'Serif' },
]

const TEXT_POSITIONS: { value: TextPosition; label: string }[] = [
  { value: 'top-left',      label: '↖' },
  { value: 'top-center',    label: '↑' },
  { value: 'top-right',     label: '↗' },
  { value: 'middle-left',   label: '←' },
  { value: 'center',        label: '·' },
  { value: 'middle-right',  label: '→' },
  { value: 'bottom-left',   label: '↙' },
  { value: 'bottom-center', label: '↓' },
  { value: 'bottom-right',  label: '↘' },
]

interface GroupRectModalProps {
  open: boolean
  onClose: () => void
  onSubmit: (data: GroupRectFormData) => void
  onDelete?: () => void
  initial?: Partial<GroupRectFormData>
  title?: string
}

export function GroupRectModal({ open, onClose, onSubmit, onDelete, initial, title = 'Add Zone' }: GroupRectModalProps) {
  const [form, setForm] = useState<GroupRectFormData>({ ...DEFAULT_FORM, ...initial })

  const set = <K extends keyof GroupRectFormData>(key: K, value: GroupRectFormData[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSubmit(form)
    onClose()
  }

  const colorFields = [
    { key: 'text_color' as const, label: 'Text' },
    { key: 'border_color' as const, label: 'Border' },
    { key: 'background_color' as const, label: 'Background' },
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
              placeholder="Zone name…"
              className="bg-[#21262d] border-[#30363d] text-sm h-8"
            />
          </div>

          {/* Font */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">Font</Label>
            <Select value={form.font} onValueChange={(v: string | null) => set('font', v ?? 'inter')}>
              <SelectTrigger className="bg-[#21262d] border-[#30363d] text-sm h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-[#21262d] border-[#30363d]">
                {FONTS.map((f) => (
                  <SelectItem key={f.value} value={f.value} className="text-sm">
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Text position 3×3 grid */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">Text Position</Label>
            <div className="grid grid-cols-3 gap-1">
              {TEXT_POSITIONS.map(({ value, label }) => {
                const isSelected = form.text_position === value
                return (
                  <button
                    key={value}
                    type="button"
                    title={value}
                    onClick={() => set('text_position', value)}
                    className="h-8 rounded text-base transition-colors"
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

          {/* Label position */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">Label Position</Label>
            <div className="grid grid-cols-2 gap-1">
              {LABEL_POSITIONS.map(({ value, label }) => {
                const isSelected = form.label_position === value
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => set('label_position', value)}
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

          {/* Colors */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">Colors</Label>
            <div className="grid grid-cols-3 gap-2">
              {colorFields.map(({ key, label }) => {
                const { hex6, alpha } = hexToRgba(form[key])
                return (
                  <div key={key} className="flex flex-col gap-1 items-center">
                    <label
                      className="relative w-full h-7 rounded-md border cursor-pointer overflow-hidden"
                      style={{ borderColor: '#30363d' }}
                    >
                      <input
                        type="color"
                        value={hex6}
                        onChange={(e) => set(key, rgbaToHex8(e.target.value, alpha))}
                        className="absolute inset-0 w-full h-full cursor-pointer opacity-0"
                      />
                      <div className="w-full h-full rounded-sm" style={{ background: form[key] }} />
                    </label>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={alpha}
                      onChange={(e) => set(key, rgbaToHex8(hex6, Number(e.target.value)))}
                      className="w-full h-1 accent-[#00d4ff] cursor-pointer"
                      title={`Opacity: ${alpha}%`}
                    />
                    <span className="text-[9px] text-muted-foreground/60">{label} {alpha}%</span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Text size */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">Text Size</Label>
            <div className="grid grid-cols-6 gap-1">
              {TEXT_SIZES.map(({ value, label }) => {
                const isSelected = form.text_size === value
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => set('text_size', value)}
                    className="flex items-center justify-center h-8 rounded transition-colors"
                    style={{
                      background: isSelected ? '#00d4ff22' : '#21262d',
                      border: `1px solid ${isSelected ? '#00d4ff88' : '#30363d'}`,
                      color: isSelected ? '#00d4ff' : '#8b949e',
                      fontSize: value,
                    }}
                  >
                    {label}
                  </button>
                )
              })}
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

          {/* Z-order */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">Z-Order (1 = furthest back)</Label>
            <Select value={String(form.z_order)} onValueChange={(v: string | null) => set('z_order', v !== null ? Number(v) : 1)}>
              <SelectTrigger className="bg-[#21262d] border-[#30363d] text-sm h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-[#21262d] border-[#30363d]">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                  <SelectItem key={n} value={String(n)} className="text-sm font-mono">
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex justify-between gap-2 pt-1">
            {onDelete && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-[#f85149] hover:text-[#f85149] hover:bg-[#f85149]/10"
                onClick={() => { onDelete(); onClose() }}
              >
                Delete
              </Button>
            )}
            <div className="flex gap-2 ml-auto">
              <Button type="button" variant="ghost" size="sm" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" size="sm" className="bg-[#00d4ff] text-[#0d1117] hover:bg-[#00d4ff]/90">
                {title === 'Add Zone' ? 'Add' : 'Save'}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

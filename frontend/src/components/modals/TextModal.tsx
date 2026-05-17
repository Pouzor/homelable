import { useState } from 'react'
import modalStyles from './modal-interactive.module.css'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { hexToRgba, rgbaToHex8 } from '@/utils/colorUtils'

export type TextBorderStyle = 'solid' | 'dashed' | 'dotted' | 'double' | 'none'

export interface TextFormData {
  text: string
  font: string
  text_color: string
  text_size: number
  border_color: string
  border_style: TextBorderStyle
  border_width: number
  background_color: string
}

const BORDER_STYLES: { value: TextBorderStyle; label: string; preview: string }[] = [
  { value: 'none',   label: 'None',   preview: '   ' },
  { value: 'solid',  label: 'Solid',  preview: '───' },
  { value: 'dashed', label: 'Dashed', preview: '╌╌╌' },
  { value: 'dotted', label: 'Dotted', preview: '···' },
  { value: 'double', label: 'Double', preview: '═══' },
]

const TEXT_SIZES: { value: number; label: string }[] = [
  { value: 10, label: '10' },
  { value: 12, label: '12' },
  { value: 14, label: '14' },
  { value: 18, label: '18' },
  { value: 24, label: '24' },
  { value: 32, label: '32' },
]

const BORDER_WIDTHS: { value: number; label: string }[] = [
  { value: 1, label: '1px' },
  { value: 2, label: '2px' },
  { value: 3, label: '3px' },
  { value: 4, label: '4px' },
  { value: 5, label: '5px' },
]

const FONTS = [
  { value: 'inter', label: 'Inter (sans-serif)' },
  { value: 'mono',  label: 'JetBrains Mono' },
  { value: 'serif', label: 'Serif' },
  { value: 'sans',  label: 'System Sans' },
]

const DEFAULT_FORM: TextFormData = {
  text: '',
  font: 'inter',
  text_color: '#e6edf3',
  text_size: 14,
  border_color: '#30363d',
  border_style: 'none',
  border_width: 1,
  background_color: '#00000000',
}

interface TextModalProps {
  open: boolean
  onClose: () => void
  onSubmit: (data: TextFormData) => void
  onDelete?: () => void
  initial?: Partial<TextFormData>
  title?: string
}

export function TextModal({ open, onClose, onSubmit, onDelete, initial, title = 'Add Text' }: TextModalProps) {
  const [form, setForm] = useState<TextFormData>({ ...DEFAULT_FORM, ...initial })

  const set = <K extends keyof TextFormData>(key: K, value: TextFormData[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSubmit(form)
    onClose()
  }

  const colorFields = [
    { key: 'text_color' as const,       label: 'Text' },
    { key: 'border_color' as const,     label: 'Border' },
    { key: 'background_color' as const, label: 'Background' },
  ]

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-[#161b22] border-[#30363d] text-foreground max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold">{title}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 mt-2">
          {/* Text content */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">Text</Label>
            <textarea
              value={form.text}
              onChange={(e) => set('text', e.target.value)}
              placeholder="Type text…"
              rows={3}
              className={`bg-[#21262d] border border-[#30363d] text-sm p-2 resize-y min-h-[60px] focus:outline-none focus:border-[#00d4ff] ${modalStyles['modal-radius']}`}
            />
          </div>

          {/* Font (Police) */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">Police</Label>
            <Select value={form.font} onValueChange={(v: string | null) => set('font', v ?? 'inter')}>
              <SelectTrigger className={`bg-[#21262d] border-[#30363d] text-sm h-8 cursor-pointer ${modalStyles['modal-interactive']} ${modalStyles['modal-radius']}`}>
                <SelectValue>
                  {FONTS.find((f) => f.value === form.font)?.label ?? form.font}
                </SelectValue>
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
            <Label className="text-xs text-muted-foreground">Size</Label>
            <div className="grid grid-cols-6 gap-1">
              {TEXT_SIZES.map(({ value, label }) => {
                const isSelected = form.text_size === value
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => set('text_size', value)}
                    className={`flex items-center justify-center h-8 rounded transition-colors cursor-pointer ${modalStyles['modal-interactive']}`}
                    style={{
                      background: isSelected ? '#00d4ff22' : '#21262d',
                      border: `1px solid ${isSelected ? '#00d4ff88' : '#30363d'}`,
                      color: isSelected ? '#00d4ff' : '#8b949e',
                      fontSize: Math.min(value, 16),
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
                    className={`flex flex-col items-center justify-center h-10 rounded text-xs gap-0.5 transition-colors cursor-pointer ${modalStyles['modal-interactive']}`}
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

          {/* Border width (only when style != none) */}
          {form.border_style !== 'none' && (
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
                      className={`flex items-center justify-center h-8 rounded text-xs transition-colors cursor-pointer ${modalStyles['modal-interactive']}`}
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
          )}

          <div className="flex justify-between gap-2 pt-1">
            {onDelete && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-[#f85149] hover:text-[#f85149] hover:bg-[#f85149]/10 cursor-pointer"
                onClick={() => { onDelete(); onClose() }}
              >
                Delete
              </Button>
            )}
            <div className="flex gap-2 ml-auto">
              <Button type="button" variant="ghost" size="sm" className={`cursor-pointer ${modalStyles['modal-cancel-hover']}`} onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" size="sm" className="bg-[#00d4ff] text-[#0d1117] hover:bg-[#00d4ff]/90 cursor-pointer">
                {title === 'Add Text' ? 'Add' : 'Save'}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

import { useState } from 'react'
import modalStyles from './modal-interactive.module.css'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { TextPosition } from '@/types'
import { hexToRgba, rgbaToHex8 } from '@/utils/colorUtils'
import { isValidCidr } from '@/utils/subnet'
import styles from './GroupRectModal.module.css'
import { t, useLocale } from '@/i18n'

export type BorderStyle = 'solid' | 'dashed' | 'dotted' | 'double' | 'none'

export type LabelPosition = 'inside' | 'outside'

export interface GroupRectFormData {
  label: string
  /** What the zone is for. Saved on the node, not on any inventory row. */
  description: string
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

const TEXT_SIZES: { value: number; label: string }[] = [
  { value: 10, label: '10' },
  { value: 12, label: '12' },
  { value: 14, label: '14' },
  { value: 16, label: '16' },
  { value: 18, label: '18' },
  { value: 20, label: '20' },
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
  description: '',
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
  /** Run the subnet import for a valid CIDR. Omit to hide the whole section. */
  onImportSubnet?: (cidr: string) => void
  /** How many unparented devices a CIDR would pull in — drives the preview line. */
  countSubnetMatches?: (cidr: string) => number
  /**
   * Add mode: the zone does not exist yet, so there is nothing to import into
   * until it is created. The CIDR is handed over on submit instead of via an
   * Import button, which would otherwise look like it did nothing.
   */
  importOnSubmit?: boolean
}

export function GroupRectModal({
  open,
  onClose,
  onSubmit,
  onDelete,
  initial,
  title = 'Add Zone',
  onImportSubnet,
  countSubnetMatches,
  importOnSubmit = false,
}: GroupRectModalProps) {
  useLocale()
  const [form, setForm] = useState<GroupRectFormData>({ ...DEFAULT_FORM, ...initial })
  const [subnet, setSubnet] = useState('')

  const cidrValid = isValidCidr(subnet)
  const showCidrError = subnet.trim() !== '' && !cidrValid
  const canImport = cidrValid && !!onImportSubnet
  const matchCount = cidrValid && countSubnetMatches ? countSubnetMatches(subnet) : null

  // Callers pass an already-translated title, so match both forms of the
  // default — otherwise zh-CN would never reach the "Add" branch.
  const isAddMode = title === 'Add Zone' || title === t('Add Zone')

  // Built inside the component so the labels go through `t`; a module-level
  // table would be created once at import, before the locale is known.
  const borderStyles: { value: BorderStyle; label: string; preview: string }[] = [
    { value: 'solid',  label: t('Solid'),  preview: '───' },
    { value: 'dashed', label: t('Dashed'), preview: '╌╌╌' },
    { value: 'dotted', label: t('Dotted'), preview: '···' },
    { value: 'double', label: t('Double'), preview: '═══' },
    { value: 'none',   label: t('None'),   preview: '   ' },
  ]
  const labelPositions: { value: LabelPosition; label: string }[] = [
    { value: 'inside',  label: t('Inside') },
    { value: 'outside', label: t('Outside') },
  ]
  const fonts = [
    { value: 'inter', label: t('Inter (sans-serif)') },
    { value: 'mono', label: t('JetBrains Mono') },
    { value: 'serif', label: t('Serif') },
  ]
  const getFontLabel = (value: string) => fonts.find((f) => f.value === value)?.label ?? value
  const colorFields = [
    { key: 'text_color' as const, label: t('Text') },
    { key: 'border_color' as const, label: t('Border') },
    { key: 'background_color' as const, label: t('Background') },
  ]

  const handleImport = () => {
    if (!canImport) return
    onImportSubnet!(subnet)
    setSubnet('')
  }

  const set = <K extends keyof GroupRectFormData>(key: K, value: GroupRectFormData[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    // Hand the CIDR over first: the caller queues it, then creates the zone and
    // runs the import against it.
    if (importOnSubmit && canImport) onImportSubnet!(subnet)
    onSubmit(form)
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-[#161b22] border-[#30363d] text-foreground max-w-[calc(100%-2rem)] sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold">{t(title)}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 mt-2">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
          {/* ── LEFT column: content & text ── */}
          <div className="flex flex-col gap-4 min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70 pb-1 border-b border-[#30363d]">{t('Content')}</div>

          {/* Label */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">{t('Label')}</Label>
            <Input
              value={form.label}
              onChange={(e) => set('label', e.target.value)}
              placeholder={t('Zone name…')}
              className={`bg-[#21262d] border-[#30363d] text-sm h-8 ${modalStyles['modal-radius']}`}
            />
          </div>

          {/* Description */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground" htmlFor="zone-description">{t('Description')}</Label>
            <textarea
              id="zone-description"
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              placeholder={t('What is in this zone, and what it is for…')}
              rows={3}
              className={`bg-[#21262d] border border-[#30363d] text-sm resize-y px-2 py-1.5 text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-[#00d4ff]/50 ${modalStyles['modal-radius']}`}
            />
          </div>

          {/* Font */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">{t('Font')}</Label>
            <Select value={form.font} onValueChange={(v: string | null) => set('font', v ?? 'inter')}>
              <SelectTrigger className={`bg-[#21262d] border-[#30363d] text-sm h-8 cursor-pointer ${modalStyles['modal-interactive']} ${modalStyles['modal-radius']}`} aria-label={t('Font selector')}>
                <SelectValue>
                  {getFontLabel(form.font)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent className="bg-[#21262d] border-[#30363d]">
                {fonts.map((f) => (
                  <SelectItem key={f.value} value={f.value} className="text-sm">
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Text position 3×3 grid */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">{t('Text Position')}</Label>
            <div className="grid grid-cols-3 gap-1">
              {TEXT_POSITIONS.map(({ value, label }) => {
                const isSelected = form.text_position === value
                return (
                  <button
                    key={value}
                    type="button"
                    title={value}
                    onClick={() => set('text_position', value)}
                    className={`h-8 rounded text-base transition-colors cursor-pointer ${modalStyles['modal-interactive']}`}
                    aria-label={t('Text position {position}', { position: label })}
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
            <Label className="text-xs text-muted-foreground">{t('Label Position')}</Label>
            <div className="grid grid-cols-2 gap-1">
              {labelPositions.map(({ value, label }) => {
                const isSelected = form.label_position === value
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => set('label_position', value)}
                    className={`flex items-center justify-center h-8 rounded text-xs transition-colors cursor-pointer ${modalStyles['modal-interactive']}`}
                    aria-label={t('Label position {position}', { position: label })}
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

          {/* Text size */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">{t('Text Size')}</Label>
            <div className="grid grid-cols-6 gap-1">
              {TEXT_SIZES.map(({ value, label }) => {
                const isSelected = form.text_size === value
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => set('text_size', value)}
                    className={`flex items-center justify-center h-8 rounded transition-colors cursor-pointer ${modalStyles['modal-interactive']}`}
                    aria-label={t('Text size {size}', { size: label })}
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
          </div>{/* ── end LEFT column ── */}

          {/* ── RIGHT column: style ── */}
          <div className="flex flex-col gap-4 min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70 pb-1 border-b border-[#30363d]">{t('Style')}</div>

          {/* Colors */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">{t('Colors')}</Label>
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
                      className={`w-full cursor-pointer mt-2 ${styles['slider-thumb']} ${styles['slider-accent']}`}
                      title={t('Opacity: {alpha}%', { alpha })}
                    />
                    <span className="text-[9px] text-muted-foreground/60">{t(label)} {alpha}%</span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Border style */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">{t('Border Style')}</Label>
            <div className="grid grid-cols-5 gap-1">
              {borderStyles.map(({ value, label, preview }) => {
                const isSelected = form.border_style === value
                return (
                  <button
                    key={value}
                    type="button"
                    title={label}
                    onClick={() => set('border_style', value)}
                    className={`flex flex-col items-center justify-center h-10 rounded text-xs gap-0.5 transition-colors cursor-pointer ${modalStyles['modal-interactive']}`}
                    aria-label={t('Border style {style}', { style: label })}
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
            <Label className="text-xs text-muted-foreground">{t('Border Width')}</Label>
            <div className="grid grid-cols-5 gap-1">
              {BORDER_WIDTHS.map(({ value, label }) => {
                const isSelected = form.border_width === value
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => set('border_width', value)}
                    className={`flex items-center justify-center h-8 rounded text-xs transition-colors cursor-pointer ${modalStyles['modal-interactive']}`}
                    aria-label={t('Border width {width}', { width: label })}
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
            <Label className="text-xs text-muted-foreground">{t('Z-Order (1 = furthest back)')}</Label>
            <Select value={String(form.z_order)} onValueChange={(v: string | null) => set('z_order', v !== null ? Number(v) : 1)}>
              <SelectTrigger className={`bg-[#21262d] border-[#30363d] text-sm h-8 cursor-pointer ${modalStyles['modal-interactive']}`} aria-label={t('Z-order selector')}>
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
          </div>{/* ── end RIGHT column ── */}
          </div>{/* ── end 2-column grid ── */}

          {/* ── Import devices by subnet ──
              Deliberately NOT part of the form: the CIDR is an argument to a
              one-shot action, never a property of the zone, so it is not
              submitted, not persisted, and cleared after each run. */}
          {onImportSubnet && (
            <div className="flex flex-col gap-2 pt-3 border-t border-[#30363d]">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                {t('Import devices by subnet')}
              </div>
              <div className="flex gap-2">
                <Input
                  value={subnet}
                  onChange={(e) => setSubnet(e.target.value)}
                  placeholder="192.168.1.0/24"
                  aria-label={t('Subnet')}
                  className={`bg-[#21262d] border-[#30363d] text-sm h-8 font-mono ${modalStyles['modal-radius']}`}
                  style={showCidrError ? { borderColor: '#f85149' } : undefined}
                  // Enter runs the import instead of submitting the whole form —
                  // except in add mode, where submitting IS how the import runs.
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !importOnSubmit) {
                      e.preventDefault()
                      handleImport()
                    }
                  }}
                />
                {!importOnSubmit && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!canImport}
                    className="cursor-pointer border-[#30363d] bg-[#21262d] shrink-0"
                    onClick={handleImport}
                  >
                    {t('Import')}
                  </Button>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground/70">
                {showCidrError
                  ? <span className="text-[#f85149]">{t('Not a valid IPv4 CIDR — try 192.168.1.0/24')}</span>
                  : matchCount === null
                    ? t('Moves every unparented device in that range into this zone. Nothing is removed.')
                    : matchCount === 0
                      ? t('No unparented device in that range.')
                      : importOnSubmit
                        ? t('{count} device{plural} will move into this zone when you add it.', {
                            count: matchCount,
                            plural: matchCount > 1 ? 's' : '',
                          })
                        : t('{count} device{plural} will move into this zone.', {
                            count: matchCount,
                            plural: matchCount > 1 ? 's' : '',
                          })}
              </p>
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
                {t('Delete')}
              </Button>
            )}
            <div className="flex gap-2 ml-auto">
              <Button type="button" variant="ghost" size="sm" className={`cursor-pointer ${modalStyles['modal-cancel-hover']}`} onClick={onClose}>
                {t('Cancel')}
              </Button>
              <Button type="submit" size="sm" className="bg-[#00d4ff] text-[#0d1117] hover:bg-[#00d4ff]/90 cursor-pointer">
                {isAddMode ? t('Add') : t('Save')}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

import { useRef, useState, type KeyboardEvent } from 'react'
import { toast } from 'sonner'
import { Check, Pencil } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { THEMES, THEME_ORDER, type ThemeId } from '@/utils/themes'
import { useThemeStore } from '@/stores/themeStore'
import { useCanvasStore } from '@/stores/canvasStore'
import { CustomStyleModal } from './CustomStyleModal'

// Node-type accent colors to display as preview swatches
const PREVIEW_TYPES = ['isp', 'server', 'proxmox', 'switch', 'iot'] as const

interface ThemeCardProps {
  themeId: ThemeId
  selected: boolean
  onClick: () => void
  onKeyDown?: (event: KeyboardEvent<HTMLButtonElement>) => void
  buttonRef?: (element: HTMLButtonElement | null) => void
  onEdit?: () => void
}

function ThemeCard({ themeId, selected, onClick, onKeyDown, buttonRef, onEdit }: ThemeCardProps) {
  const { customStyle } = useThemeStore()
  const preset = THEMES[themeId]
  const c = preset.colors
  const isCustom = themeId === 'custom'

  // For custom theme, use defined node colors for preview swatches
  const swatchColors = isCustom
    ? PREVIEW_TYPES.map((t) => customStyle.nodes[t]?.borderColor ?? c.nodeAccents[t].border)
    : PREVIEW_TYPES.map((t) => c.nodeAccents[t].border)

  const ethernetColor = isCustom
    ? (customStyle.edges['ethernet']?.color ?? c.edgeColors.ethernet)
    : c.edgeColors.ethernet
  const wifiColor = isCustom
    ? (customStyle.edges['wifi']?.color ?? c.edgeColors.wifi)
    : c.edgeColors.wifi

  return (
    <div className="relative w-full h-full">
      <button
        ref={buttonRef}
        type="button"
        onClick={onClick}
        onKeyDown={onKeyDown}
        className="relative rounded-xl border-2 p-3 text-left transition-all duration-150 focus:outline-none w-full h-full flex flex-col"
        style={{
          borderColor: selected ? c.nodeAccents.isp.border : c.handleBackground,
          background: c.canvasBackground,
          boxShadow: selected ? `0 0 0 1px ${c.nodeAccents.isp.border}44, 0 0 12px ${c.nodeAccents.isp.border}22` : 'none',
        }}
      >
        {/* Selected checkmark */}
        {selected && (
          <span
            className="absolute top-2 right-2 flex items-center justify-center w-4 h-4 rounded-full"
            style={{ background: c.nodeAccents.isp.border }}
          >
            <Check size={10} style={{ color: c.canvasBackground }} />
          </span>
        )}

        {/* Mini canvas preview */}
        <div
          className="rounded-md mb-2.5 flex flex-col gap-1.5 p-2"
          style={{ background: c.nodeCardBackground, border: `1px solid ${c.handleBackground}` }}
        >
          <div className="flex gap-1 items-center flex-wrap">
            {swatchColors.map((color, i) => (
              <span
                key={i}
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
          <div style={{ height: 2, background: ethernetColor, width: '80%', borderRadius: 2 }} />
          <div
            style={{
              height: 1,
              width: '55%',
              backgroundImage: `repeating-linear-gradient(90deg, ${wifiColor} 0 5px, transparent 5px 8px)`,
            }}
          />
        </div>

        <div
          className="text-sm font-semibold leading-tight wrap-break-word"
          style={{ color: c.nodeLabelColor }}
        >
          {preset.label}
        </div>
        <div
          className="text-xs leading-snug mt-1 line-clamp-3 whitespace-normal wrap-break-word overflow-hidden min-h-12"
          style={{ color: c.nodeSubtextColor }}
        >
          {preset.description}
        </div>
      </button>

      {/* Edit button — only for custom theme */}
      {isCustom && onEdit && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onEdit() }}
          title="Edit custom style"
          className="absolute bottom-2 right-2 flex items-center justify-center w-6 h-6 rounded-md transition-colors"
          style={{
            background: c.nodeCardBackground,
            color: c.nodeLabelColor,
            border: `1px solid ${c.handleBackground}`,
          }}
        >
          <Pencil size={11} />
        </button>
      )}
    </div>
  )
}

interface ThemeModalProps {
  open: boolean
  onClose: () => void
}

export function ThemeModal({ open, onClose }: ThemeModalProps) {
  const { activeTheme, setTheme } = useThemeStore()
  const { markUnsaved } = useCanvasStore()
  const cardRefs = useRef<Array<HTMLButtonElement | null>>([])
  const [customStyleOpen, setCustomStyleOpen] = useState(false)

  // Capture the theme that was active when the modal opened
  const [originalTheme] = useState<ThemeId>(activeTheme)
  const [selected, setSelected] = useState<ThemeId>(activeTheme)

  const handleSelect = (id: ThemeId) => {
    setSelected(id)
    setTheme(id)
  }

  const handleCardKeyDown = (index: number) => (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      handleApply()
      return
    }

    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return

    event.preventDefault()
    const direction = event.key === 'ArrowRight' ? 1 : -1
    const nextIndex = (index + direction + THEME_ORDER.length) % THEME_ORDER.length
    const nextTheme = THEME_ORDER[nextIndex]

    setSelected(nextTheme)
    setTheme(nextTheme)

    const nextCard = cardRefs.current[nextIndex]
    if (!nextCard) return

    nextCard.focus({ preventScroll: true })
    nextCard.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
  }

  const handleApply = () => {
    setTheme(selected)
    markUnsaved()
    onClose()
    toast.info('Style applied — save your canvas to make it permanent', { duration: 5000 })
  }

  const handleCancel = () => {
    setTheme(originalTheme)
    onClose()
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => { if (!o) handleCancel() }}>
        <DialogContent className="bg-[#161b22] border-[#30363d] w-fit max-w-[calc(100%-2rem)] sm:max-w-[50vw]">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">Choose Canvas Style</DialogTitle>
          </DialogHeader>

          <div className="flex items-stretch flex-nowrap gap-3 py-1 overflow-x-auto overflow-y-hidden pb-2 pr-1">
            {THEME_ORDER.map((id, index) => (
              <div key={id} className="shrink-0 w-30 md:w-24 h-full">
                <ThemeCard
                  themeId={id}
                  selected={selected === id}
                  onClick={() => handleSelect(id)}
                  onKeyDown={handleCardKeyDown(index)}
                  buttonRef={(element) => { cardRefs.current[index] = element }}
                  onEdit={id === 'custom' ? () => setCustomStyleOpen(true) : undefined}
                />
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-muted-foreground hover:text-foreground"
              onClick={handleCancel}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              className="bg-[#00d4ff] text-[#0d1117] hover:bg-[#00d4ff]/90"
              style={
                selected !== 'default'
                  ? { background: THEMES[selected].colors.nodeAccents.isp.border }
                  : undefined
              }
              onClick={handleApply}
            >
              Apply Style
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <CustomStyleModal open={customStyleOpen} onClose={() => setCustomStyleOpen(false)} />
    </>
  )
}

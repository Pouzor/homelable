import { useState } from 'react'
import { toast } from 'sonner'
import { Check } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { THEMES, THEME_ORDER, type ThemeId } from '@/utils/themes'
import { useThemeStore } from '@/stores/themeStore'
import { useCanvasStore } from '@/stores/canvasStore'

// Node-type accent colors to display as preview swatches
const PREVIEW_TYPES = ['isp', 'server', 'proxmox', 'switch', 'iot'] as const

interface ThemeCardProps {
  themeId: ThemeId
  selected: boolean
  onClick: () => void
}

function ThemeCard({ themeId, selected, onClick }: ThemeCardProps) {
  const preset = THEMES[themeId]
  const c = preset.colors

  return (
    <button
      type="button"
      onClick={onClick}
      className="relative rounded-xl border-2 p-3.5 text-left transition-all duration-150 focus:outline-none w-full min-h-[150px] overflow-hidden"
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
        className="rounded-md mb-3 flex flex-col gap-2 p-2.5"
        style={{ background: c.nodeCardBackground, border: `1px solid ${c.handleBackground}` }}
      >
        {/* Node accent dots */}
        <div className="flex gap-1 items-center flex-wrap">
          {PREVIEW_TYPES.map((type) => (
            <span
              key={type}
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ backgroundColor: c.nodeAccents[type].border }}
            />
          ))}
        </div>
        {/* Edge line */}
        <div style={{ height: 2, background: c.edgeColors.ethernet, width: '80%', borderRadius: 2 }} />
        {/* Wifi dashed line */}
        <div
          style={{
            height: 1,
            width: '55%',
            backgroundImage: `repeating-linear-gradient(90deg, ${c.edgeColors.wifi} 0 5px, transparent 5px 8px)`,
          }}
        />
      </div>

      {/* Label */}
      <div
        className="text-sm font-semibold leading-tight break-words"
        style={{ color: c.nodeLabelColor }}
      >
        {preset.label}
      </div>
      <div
        className="text-xs leading-snug mt-1 line-clamp-2 break-words"
        style={{ color: c.nodeSubtextColor }}
      >
        {preset.description}
      </div>
    </button>
  )
}

interface ThemeModalProps {
  open: boolean
  onClose: () => void
}

export function ThemeModal({ open, onClose }: ThemeModalProps) {
  const { activeTheme, setTheme } = useThemeStore()
  const { markUnsaved } = useCanvasStore()

  // Capture the theme that was active when the modal opened
  const [originalTheme] = useState<ThemeId>(activeTheme)
  const [selected, setSelected] = useState<ThemeId>(activeTheme)

  const handleSelect = (id: ThemeId) => {
    setSelected(id)
    // Live-preview the selected theme on the canvas
    setTheme(id)
  }

  const handleApply = () => {
    setTheme(selected)
    markUnsaved()
    onClose()
    toast.info('Style applied — save your canvas to make it permanent', {
      duration: 5000,
    })
  }

  const handleCancel = () => {
    // Revert to the original theme
    setTheme(originalTheme)
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleCancel() }}>
      <DialogContent className="bg-[#161b22] border-[#30363d] !w-[96vw] !max-w-[1280px]">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold">Choose Canvas Style</DialogTitle>
        </DialogHeader>

        <div className="py-1">
          <div className="grid grid-cols-5 gap-3">
            {THEME_ORDER.map((id) => (
              <ThemeCard
                key={id}
                themeId={id}
                selected={selected === id}
                onClick={() => handleSelect(id)}
              />
            ))}
          </div>
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
  )
}

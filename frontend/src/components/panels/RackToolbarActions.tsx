/**
 * Rack-specific middle group of the header toolbar.
 *
 * Replaces the logical canvas actions (auto layout, YAML import/export) with the
 * ones a rack canvas actually has: adding racks, patching, and controlling how
 * much of the cabling is on screen.
 */
import { useState } from 'react'
import { Cable, Eye, EyeOff, Link2, MousePointer2, Plus, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useRackStore } from '@/rack/store'
import { useRackPalette } from '@/rack/rackTheme'
import { loadNetworkLinks } from '@/rack/networkLinks'
import { useDesignStore } from '@/stores/designStore'
import { t, useLocale } from '@/i18n'
import type { CableVisibility } from '@/types'

const STANDALONE = import.meta.env.VITE_STANDALONE === 'true'

const ghost =
  'gap-1.5 text-muted-foreground hover:text-foreground cursor-pointer hover:bg-[#21262d]'
/** Reads as one of the ghost buttons around it: no box until you hover it. */
const triggerClass =
  'gap-1.5 border-transparent bg-transparent px-2 text-xs font-medium text-muted-foreground hover:bg-[#21262d] hover:text-foreground dark:bg-transparent dark:hover:bg-[#21262d] cursor-pointer'

export function RackToolbarActions() {
  useLocale()
  const palette = useRackPalette()
  // Built inside the component so the labels go through `t`; a module-level
  // table would be created once at import, before the locale is known.
  const visibilityOptions: { value: CableVisibility; label: string; icon: typeof Eye }[] = [
    { value: 'hover', label: t('Cables on hover'), icon: MousePointer2 },
    { value: 'always', label: t('Cables always'), icon: Eye },
    { value: 'hidden', label: t('Cables hidden'), icon: EyeOff },
  ]
  const addRack = useRackStore((s) => s.addRack)
  const cableMode = useRackStore((s) => s.cableMode)
  const toggleCableMode = useRackStore((s) => s.toggleCableMode)
  const cableVisibility = useRackStore((s) => s.cableVisibility)
  const setCableVisibility = useRackStore((s) => s.setCableVisibility)
  const cableDraft = useRackStore((s) => s.cableDraft)
  const cancelCableDraft = useRackStore((s) => s.cancelCableDraft)
  const selectedCableId = useRackStore((s) => s.selectedCableId)
  const removeSelectedCable = useRackStore((s) => s.removeSelectedCable)
  const importCables = useRackStore((s) => s.importCablesFromNetwork)
  const designs = useDesignStore((s) => s.designs)
  const [importing, setImporting] = useState(false)

  async function handleImport() {
    setImporting(true)
    try {
      const hints = STANDALONE ? [] : await loadNetworkLinks(designs)
      const created = importCables(hints)
      toast[created > 0 ? 'success' : 'info'](
        created > 0
          ? t('{count} cable{plural} imported from the network canvas', { count: created, plural: created > 1 ? 's' : '' })
          : t('No matching link found — rack the devices first'),
      )
    } finally {
      setImporting(false)
    }
  }

  return (
    <>
      <Button size="sm" variant="ghost" className={ghost} onClick={() => addRack({ style: palette.defaultRackStyle })}>
        <Plus size={14} /> {t('Rack')}
      </Button>

      <Button
        size="sm"
        variant="ghost"
        className={`${ghost} ${cableMode ? 'text-[#00d4ff]' : ''}`}
        onClick={toggleCableMode}
        title={t('Drag from one port to another to patch, or click both in turn. Click a cable to select it, then Delete to unplug.')}
      >
        <Cable size={14} /> {cableMode ? t('Exit patching') : t('Patch')}
      </Button>

      {cableMode && cableDraft && (
        <Button
          size="sm"
          variant="ghost"
          className={`${ghost} text-[#e3b341]`}
          onClick={cancelCableDraft}
        >
          <X size={14} /> {t('Cancel cable')}
        </Button>
      )}

      {cableMode && selectedCableId && (
        <Button
          size="sm"
          variant="ghost"
          className={`${ghost} text-[#f85149]`}
          onClick={removeSelectedCable}
          title={t('Unplug the selected cable (Delete)')}
        >
          <Trash2 size={14} /> {t('Unplug')}
        </Button>
      )}

      <Select value={cableVisibility} onValueChange={(v) => setCableVisibility(v as CableVisibility)}>
        <SelectTrigger size="sm" className={triggerClass} aria-label={t('Cable visibility')}>
          <SelectValue>
            {(() => {
              const { icon: Icon, label } = visibilityOptions.find((o) => o.value === cableVisibility)!
              return <><Icon size={14} /> {label}</>
            })()}
          </SelectValue>
        </SelectTrigger>
        <SelectContent className="bg-[#21262d] border-[#30363d]">
          {visibilityOptions.map(({ value, icon: Icon, label }) => (
            <SelectItem key={value} value={value} className="text-xs">
              <Icon size={14} /> {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {!STANDALONE && (
        <Button
          size="sm"
          variant="ghost"
          className={ghost}
          disabled={importing}
          onClick={() => void handleImport()}
          title={t('One-shot: derive patches from the links already drawn on the logical canvases')}
        >
          <Link2 size={14} /> {t('Import links')}
        </Button>
      )}
    </>
  )
}

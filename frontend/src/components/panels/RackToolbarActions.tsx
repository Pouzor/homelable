/**
 * Rack-specific middle group of the header toolbar.
 *
 * Replaces the logical canvas actions (auto layout, YAML import/export) with the
 * ones a rack canvas actually has: adding racks, patching, and controlling how
 * much of the cabling is on screen.
 */
import { useState } from 'react'
import { Cable, Link2, Plus, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useRackStore } from '@/rack/store'
import { useRackPalette } from '@/rack/rackTheme'
import { loadNetworkLinks } from '@/rack/networkLinks'
import { CABLE_TYPE_LABELS } from '@/rack/rackDefaults'
import { useDesignStore } from '@/stores/designStore'
import type { CableType, CableVisibility } from '@/types'

const STANDALONE = import.meta.env.VITE_STANDALONE === 'true'

const ghost =
  'gap-1.5 text-muted-foreground hover:text-foreground cursor-pointer hover:bg-[#21262d]'
const selectClass =
  'rounded border border-border bg-[#0d1117] px-2 py-1 text-xs text-foreground outline-none focus:border-[#00d4ff] cursor-pointer'

export function RackToolbarActions() {
  const palette = useRackPalette()
  const addRack = useRackStore((s) => s.addRack)
  const cableMode = useRackStore((s) => s.cableMode)
  const toggleCableMode = useRackStore((s) => s.toggleCableMode)
  const cableVisibility = useRackStore((s) => s.cableVisibility)
  const setCableVisibility = useRackStore((s) => s.setCableVisibility)
  const cableTypeFilter = useRackStore((s) => s.cableTypeFilter)
  const setCableTypeFilter = useRackStore((s) => s.setCableTypeFilter)
  const cableDraft = useRackStore((s) => s.cableDraft)
  const cancelCableDraft = useRackStore((s) => s.cancelCableDraft)
  const selectedCableId = useRackStore((s) => s.selectedCableId)
  const removeSelectedCable = useRackStore((s) => s.removeSelectedCable)
  const importCables = useRackStore((s) => s.importCablesFromNetwork)
  const networkImportDone = useRackStore((s) => s.networkImportDone)
  const designs = useDesignStore((s) => s.designs)
  const [importing, setImporting] = useState(false)

  async function handleImport() {
    setImporting(true)
    try {
      const hints = STANDALONE ? [] : await loadNetworkLinks(designs)
      const created = importCables(hints)
      toast[created > 0 ? 'success' : 'info'](
        created > 0
          ? `${created} cable${created > 1 ? 's' : ''} imported from the network canvas`
          : 'No matching link found — rack the devices first',
      )
    } finally {
      setImporting(false)
    }
  }

  return (
    <>
      <Button size="sm" variant="ghost" className={ghost} onClick={() => addRack({ style: palette.defaultRackStyle })}>
        <Plus size={14} /> Rack
      </Button>

      <Button
        size="sm"
        variant="ghost"
        className={`${ghost} ${cableMode ? 'text-[#00d4ff]' : ''}`}
        onClick={toggleCableMode}
        title="Drag from one port to another to patch, or click both in turn. Click a cable to select it, then Delete to unplug."
      >
        <Cable size={14} /> {cableMode ? 'Exit patching' : 'Patch'}
      </Button>

      {cableMode && cableDraft && (
        <Button
          size="sm"
          variant="ghost"
          className={`${ghost} text-[#e3b341]`}
          onClick={cancelCableDraft}
        >
          <X size={14} /> Cancel cable
        </Button>
      )}

      {cableMode && selectedCableId && (
        <Button
          size="sm"
          variant="ghost"
          className={`${ghost} text-[#f85149]`}
          onClick={removeSelectedCable}
          title="Unplug the selected cable (Delete)"
        >
          <Trash2 size={14} /> Unplug
        </Button>
      )}

      <select
        className={selectClass}
        aria-label="Cable visibility"
        value={cableVisibility}
        onChange={(e) => setCableVisibility(e.target.value as CableVisibility)}
      >
        <option value="hover">Cables on hover</option>
        <option value="always">Cables always</option>
        <option value="hidden">Cables hidden</option>
      </select>

      <select
        className={selectClass}
        aria-label="Cable type filter"
        value={cableTypeFilter}
        onChange={(e) => setCableTypeFilter(e.target.value as CableType | 'all')}
      >
        <option value="all">All types</option>
        {(Object.keys(CABLE_TYPE_LABELS) as CableType[]).map((t) => (
          <option key={t} value={t}>
            {CABLE_TYPE_LABELS[t]}
          </option>
        ))}
      </select>

      {!STANDALONE && (
        <Button
          size="sm"
          variant="ghost"
          className={ghost}
          disabled={networkImportDone || importing}
          onClick={() => void handleImport()}
          title="One-shot: derive patches from the links already drawn on the logical canvases"
        >
          <Link2 size={14} /> Import links
        </Button>
      )}
    </>
  )
}

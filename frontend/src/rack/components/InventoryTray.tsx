/**
 * Sidebar section for rack designs: Device Inventory entries and rack
 * accessories, both drag sources for the canvas.
 *
 * The inventory is the app's Device Inventory — unmounting gear from a rack
 * never removes it here.
 */
import { useState } from 'react'
import { PlusCircle, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { FACEPLATES, getFaceplate } from '../faceplates'
import { useRackStore } from '../store'
import type { InventoryDevice } from '@/types'
import { endDrag, startDrag } from './dragPayload'

const STATUS_DOT: Record<InventoryDevice['status'], string> = {
  online: '#39d353',
  offline: '#f85149',
  unknown: '#8b949e',
}

const STANDALONE = import.meta.env.VITE_STANDALONE === 'true'

export function InventoryTray() {
  const inventory = useRackStore((s) => s.inventory)
  const createInventoryDevice = useRackStore((s) => s.createInventoryDevice)
  const refreshInventory = useRackStore((s) => s.refreshInventory)
  const [adding, setAdding] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [busy, setBusy] = useState(false)

  const unracked = inventory.filter((i) => !i.racked)
  const racked = inventory.filter((i) => i.racked)
  const accessories = FACEPLATES.filter((f) => f.kind === 'accessory')

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    const label = draftName.trim()
    if (!label) return
    setBusy(true)
    const created = await createInventoryDevice({ label })
    setBusy(false)
    if (!created) {
      toast.error('Could not add the device')
      return
    }
    setDraftName('')
    setAdding(false)
    toast.success(`${label} added to the inventory`)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-2 text-sm text-foreground">
      <div className="flex items-center justify-between pt-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Unracked ({unracked.length})
        </h2>
        {!STANDALONE && (
          <button
            type="button"
            title="Refresh from the Device Inventory"
            aria-label="Refresh inventory"
            onClick={() => void refreshInventory()}
            className="p-1 text-muted-foreground hover:text-foreground cursor-pointer"
          >
            <RefreshCw size={12} />
          </button>
        )}
      </div>
      <p className="mb-2 text-[11px] leading-snug text-muted-foreground">
        Drag onto a rack. Unmounting never deletes the device from the inventory.
      </p>

      <ul className="mb-3 space-y-1">
        {unracked.map((item) => (
          <li
            key={item.id}
            draggable
            onDragStart={(e) =>
              startDrag(e.dataTransfer, {
                kind: 'inventory',
                id: item.id,
                faceplateId: item.suggestedFaceplateId,
              })
            }
            onDragEnd={endDrag}
            className="flex cursor-grab items-center gap-2 rounded border border-border bg-[#161b22] px-2 py-1.5 hover:border-[#00d4ff]"
            title={`${item.type ?? 'device'}${item.ip ? ` · ${item.ip}` : ''} · ${getFaceplate(item.suggestedFaceplateId).label}`}
          >
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ background: STATUS_DOT[item.status] }}
            />
            <span className="truncate text-xs">{item.label}</span>
            <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">
              {getFaceplate(item.suggestedFaceplateId).uHeight}U
            </span>
          </li>
        ))}
        {unracked.length === 0 && (
          <li className="px-2 py-1 text-[11px] text-muted-foreground">Everything is racked.</li>
        )}
      </ul>

      {adding ? (
        <form onSubmit={handleCreate} className="mb-3 space-y-1">
          <input
            autoFocus
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            placeholder="Device name"
            aria-label="Device name"
            className="w-full rounded border border-border bg-[#0d1117] px-2 py-1 text-xs text-foreground outline-none focus:border-[#00d4ff]"
          />
          <div className="flex gap-1">
            <button
              type="submit"
              disabled={busy || !draftName.trim()}
              className="flex-1 rounded border border-[#00d4ff] px-2 py-1 text-[11px] text-[#00d4ff] hover:bg-[#00d4ff]/10 disabled:opacity-40 cursor-pointer"
            >
              Add
            </button>
            <button
              type="button"
              onClick={() => { setAdding(false); setDraftName('') }}
              className="rounded border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="mb-3 flex items-center gap-1.5 rounded px-2 py-1 text-[11px] text-[#00d4ff] hover:bg-[#00d4ff]/10 cursor-pointer"
        >
          <PlusCircle size={12} /> New device
        </button>
      )}

      <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Accessories
      </h2>
      <ul className="mb-3 space-y-1">
        {accessories.map((plate) => (
          <li
            key={plate.id}
            draggable
            onDragStart={(e) =>
              startDrag(e.dataTransfer, {
                kind: 'accessory',
                id: plate.id,
                faceplateId: plate.id,
              })
            }
            onDragEnd={endDrag}
            className="cursor-grab rounded border border-border bg-[#161b22] px-2 py-1.5 text-xs hover:border-[#00d4ff]"
          >
            {plate.label}
          </li>
        ))}
      </ul>

      {racked.length > 0 && (
        <>
          <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Racked ({racked.length})
          </h2>
          <ul className="space-y-1">
            {racked.map((item) => (
              <li
                key={item.id}
                className="flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground"
              >
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ background: STATUS_DOT[item.status] }}
                />
                <span className="truncate">{item.label}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

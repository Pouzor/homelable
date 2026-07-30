/** Left rail: unracked inventory + rack accessories, both drag sources. */
import { FACEPLATES, getFaceplate } from '../faceplates'
import { useRackStore } from '../store'
import type { InventoryDevice } from '../types'
import { endDrag, startDrag } from './dragPayload'

const STATUS_DOT: Record<InventoryDevice['status'], string> = {
  online: '#39d353',
  offline: '#f85149',
  unknown: '#8b949e',
}

export function InventoryTray() {
  const inventory = useRackStore((s) => s.inventory)
  const devices = useRackStore((s) => s.devices)

  const mountedNodeIds = new Set(devices.map((d) => d.nodeId).filter(Boolean))
  const unracked = inventory.filter((i) => !mountedNodeIds.has(i.id))
  const racked = inventory.filter((i) => mountedNodeIds.has(i.id))
  const accessories = FACEPLATES.filter((f) => f.kind === 'accessory')

  return (
    <aside className="w-64 shrink-0 overflow-y-auto border-r border-[#21262d] bg-[#0d1117] p-3 text-sm text-[#c9d1d9]">
      <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-[#6e7681]">
        Inventory · unracked ({unracked.length})
      </h2>
      <p className="mb-2 text-[11px] leading-snug text-[#6e7681]">
        Drag onto a rack. Removing gear from a rack never deletes it here.
      </p>
      <ul className="mb-4 space-y-1">
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
            className="flex cursor-grab items-center gap-2 rounded border border-[#21262d] bg-[#161b22] px-2 py-1.5 hover:border-[#00d4ff]"
            title={`${item.type}${item.ip ? ` · ${item.ip}` : ''} · ${getFaceplate(item.suggestedFaceplateId).label}`}
          >
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ background: STATUS_DOT[item.status] }}
            />
            <span className="truncate">{item.label}</span>
            <span className="ml-auto shrink-0 font-mono text-[10px] text-[#6e7681]">
              {getFaceplate(item.suggestedFaceplateId).uHeight}U
            </span>
          </li>
        ))}
        {unracked.length === 0 && (
          <li className="px-2 py-1 text-[11px] text-[#6e7681]">Everything is racked.</li>
        )}
      </ul>

      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#6e7681]">
        Accessories
      </h2>
      <ul className="mb-4 space-y-1">
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
            className="cursor-grab rounded border border-[#21262d] bg-[#161b22] px-2 py-1.5 hover:border-[#00d4ff]"
          >
            {plate.label}
          </li>
        ))}
      </ul>

      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#6e7681]">
        Racked ({racked.length})
      </h2>
      <ul className="space-y-1">
        {racked.map((item) => (
          <li key={item.id} className="flex items-center gap-2 px-2 py-1 text-[#6e7681]">
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ background: STATUS_DOT[item.status] }}
            />
            <span className="truncate">{item.label}</span>
          </li>
        ))}
      </ul>
    </aside>
  )
}

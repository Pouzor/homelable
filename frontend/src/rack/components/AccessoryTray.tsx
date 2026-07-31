/**
 * Sidebar section for rack designs: rack accessories, as drag sources.
 *
 * Devices themselves are not listed here — they live in the app's **Device
 * Inventory** (`pending_devices`), under its "Rack devices" source filter, so
 * they get the same search / filter / hide / delete tooling as scanned gear.
 * Mounting one is the `+ Device` modal's job. Accessories (blanks, shelves,
 * cable managers) are rack-only artwork with no inventory row, so they stay.
 */
import { FACEPLATES } from '../faceplates'
import { endDrag, startDrag } from './dragPayload'

export function AccessoryTray() {
  const accessories = FACEPLATES.filter((f) => f.kind === 'accessory')

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-2 text-sm text-foreground">
      <h2 className="pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Accessories
      </h2>
      <p className="mb-2 text-[11px] leading-snug text-muted-foreground">
        Drag onto a rack. Devices come from the Device Inventory — use + Device.
      </p>
      <ul className="space-y-1">
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
    </div>
  )
}

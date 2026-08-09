/**
 * Pick the Device Inventory entry a mount stands for.
 *
 * A plate created from the rack carries a placeholder entry with nothing in it
 * but a name, and discovery only *guesses* the canvas node behind an entry
 * (IEEE, then IP) — so a device it cannot correlate stays bare however complete
 * its twin is. This is the way in: point the plate at the inventory row that
 * already holds the IP, the MAC, the services and, when there is one, the
 * canvas node.
 *
 * The list is the Device Inventory itself, not the logical canvases: an entry
 * no one ever approved onto a canvas is still the record of a real box, and is
 * exactly what a rack is built out of.
 */
import { useEffect, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useRackStore } from '../store'
import { useRackPalette } from '../rackTheme'
import type { InventoryDevice } from '@/types'

/** Discovery labels, as the Device Inventory prints them. */
const SOURCE_LABELS: Record<string, string> = {
  arp: 'Network scan',
  proxmox: 'Proxmox',
  zigbee: 'Zigbee',
  zwave: 'Z-Wave',
  manual: 'Added by hand',
  rack: 'Rack device',
}

function sourceLabel(source: string | null | undefined): string | null {
  if (!source) return null
  return SOURCE_LABELS[source] ?? source
}

function matches(item: InventoryDevice, query: string): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  return [
    item.label,
    item.type,
    item.ip,
    item.hostname,
    item.mac,
    item.node?.designName,
    sourceLabel(item.discoverySource),
  ].some((v) => v?.toLowerCase().includes(q))
}

interface Props {
  open: boolean
  /** Entry the mount already points at, highlighted in the list. */
  value?: string | null
  onPick: (entry: InventoryDevice) => void
  onClose: () => void
}

export function DevicePickerModal({ open, value, onPick, onClose }: Props) {
  const palette = useRackPalette()
  const inventory = useRackStore((s) => s.inventory)
  const refreshInventory = useRackStore((s) => s.refreshInventory)
  const [query, setQuery] = useState('')

  // The Device Inventory lives outside the rack — a scan, an approval or a
  // rename can land while this modal's parent stays open.
  useEffect(() => {
    if (open) void refreshInventory()
  }, [open, refreshInventory])

  // One entry, one mount: a device already on a plate in this design is not on
  // offer, or two plates would follow the same box.
  const visible = useMemo(
    () => inventory.filter((i) => (!i.racked || i.id === value) && matches(i, query)),
    [inventory, value, query],
  )

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="border-[#30363d] bg-[#161b22] text-foreground max-w-[calc(100%-2rem)] sm:max-w-xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold">Link to an inventory device</DialogTitle>
        </DialogHeader>

        <div className="relative">
          <Search
            size={13}
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            autoFocus
            aria-label="Search devices"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, IP, hostname or source…"
            className="w-full rounded border border-[#30363d] bg-[#21262d] py-1 pl-7 pr-2 text-sm text-foreground outline-none focus:border-[#00d4ff]"
          />
        </div>

        {visible.length === 0 && (
          <p className="text-[11px] text-muted-foreground">
            {inventory.length === 0
              ? 'The Device Inventory is empty. Run a scan or add a device by hand.'
              : 'No device matches that search.'}
          </p>
        )}

        <ul className="flex max-h-[50vh] flex-col gap-1 overflow-y-auto">
          {visible.map((item) => {
            const source = sourceLabel(item.discoverySource)
            // Where the logical twin is drawn, when discovery found one — the
            // reason two look-alike entries are not the same device.
            const canvas = item.node?.designName ?? null
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onPick(item)}
                  className={`flex w-full cursor-pointer items-center gap-2 rounded border px-2 py-1.5 text-left hover:border-[#00d4ff] ${
                    item.id === value ? 'border-[#00d4ff]' : 'border-[#30363d]'
                  }`}
                >
                  <span
                    aria-hidden
                    className="inline-block h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: palette.status[item.status] }}
                  />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm">{item.label}</span>
                    <span className="truncate text-[11px] text-muted-foreground">
                      {[item.type, source, canvas].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  {(item.ip || item.mac) && (
                    <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                      {item.ip || item.mac}
                    </span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      </DialogContent>
    </Dialog>
  )
}

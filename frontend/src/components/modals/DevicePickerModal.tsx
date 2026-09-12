import { useMemo, useState } from 'react'
import { Check, Plus, Search } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { InventoryEntry } from '@/types'
import { deviceName } from '@/utils/mergeWinner'
import { deviceAddresses } from '@/utils/deviceFacts'

/** Everything a search term is matched against — names and addresses alike. */
function haystack(device: InventoryEntry): string {
  return [
    device.label,
    device.friendly_name,
    device.hostname,
    device.ip,
    device.mac,
    device.ieee_address,
    device.type,
    device.suggested_type,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

interface DevicePickerModalProps {
  open: boolean
  /** The inventory to choose from, already filtered of anything unlinkable. */
  devices: InventoryEntry[]
  /** The row the node draws today, ticked in the list. */
  currentDeviceId?: string | null
  /** True while a new row is being created — the dialog stays up, disabled. */
  busy?: boolean
  onPick: (device: InventoryEntry) => void
  onCreate: () => void
  onClose: () => void
}

/**
 * Which Device Inventory row a canvas node draws.
 *
 * A homelab inventory runs to hundreds of rows, most of them named after the
 * same handful of hosts, and a dropdown gave no way to tell two `proxmox-1`
 * apart or to find one by address. So: a search over every name and address a
 * row answers to, the addresses printed beside each name, and the way out —
 * a device of its own — as a button rather than the last item of a long list.
 */
export function DevicePickerModal({
  open,
  devices,
  currentDeviceId,
  busy = false,
  onPick,
  onCreate,
  onClose,
}: DevicePickerModalProps) {
  const [query, setQuery] = useState('')

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const list = needle
      ? devices.filter((d) => haystack(d).includes(needle))
      : [...devices]
    // The row already linked first — it is the one the user is deciding about.
    return list.sort((a, b) => {
      if (a.id === currentDeviceId) return -1
      if (b.id === currentDeviceId) return 1
      return deviceName(a).localeCompare(deviceName(b))
    })
  }, [devices, query, currentDeviceId])

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="bg-[#161b22] border-[#30363d] text-foreground max-w-[calc(100%-2rem)] sm:max-w-xl p-0 gap-0">
        <DialogHeader className="px-4 py-3 border-b border-[#30363d]">
          <DialogTitle className="text-sm font-semibold">Link to a device</DialogTitle>
        </DialogHeader>

        <div className="px-4 py-3 border-b border-[#30363d]">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/60" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, address or hostname"
              aria-label="Search devices"
              className="bg-[#21262d] border-[#30363d] text-sm h-8 pl-8"
            />
          </div>
        </div>

        <div className="max-h-[46vh] overflow-y-auto py-1">
          {matches.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-muted-foreground">
              {devices.length === 0
                ? 'The Device Inventory is empty.'
                : `No device matches "${query.trim()}".`}
            </p>
          ) : (
            matches.map((device) => {
              const addresses = deviceAddresses(device)
              const isCurrent = device.id === currentDeviceId
              return (
                <button
                  key={device.id}
                  type="button"
                  disabled={busy}
                  onClick={() => onPick(device)}
                  className={`w-full flex items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-[#21262d] disabled:opacity-50 ${isCurrent ? 'bg-[#00d4ff]/5' : ''}`}
                >
                  <span className="flex flex-col min-w-0 flex-1">
                    <span className={`text-sm truncate ${isCurrent ? 'text-[#00d4ff]' : 'text-foreground'}`}>
                      {deviceName(device)}
                    </span>
                    {addresses && (
                      <span className="text-[10px] font-mono text-muted-foreground/70 truncate">
                        {addresses}
                      </span>
                    )}
                  </span>
                  {isCurrent && <Check className="w-3.5 h-3.5 shrink-0 text-[#00d4ff]" />}
                </button>
              )
            })
          )}
        </div>

        <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-[#30363d]">
          <Button
            type="button"
            disabled={busy}
            onClick={onCreate}
            className="h-8 px-3 text-xs bg-[#21262d] hover:bg-[#30363d] text-foreground"
          >
            <Plus className="w-3.5 h-3.5 mr-1.5" />
            Create a separate device
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            className="h-8 px-3 text-xs text-muted-foreground hover:text-foreground"
          >
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

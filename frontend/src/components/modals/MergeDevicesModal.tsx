import { useState } from 'react'
import { Merge, Layers } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import type { InventoryEntry } from '@/types'
import { deviceName, factCount, suggestWinner } from '@/utils/mergeWinner'

const ACCENT = '#00d4ff'

interface MergeDevicesModalProps {
  open: boolean
  /** The rows the user selected in the inventory. Two or more. */
  devices: InventoryEntry[]
  onCancel: () => void
  onConfirm: (winnerId: string) => void
  /** True while the request is in flight — the dialog stays up, disabled. */
  busy?: boolean
}

/**
 * Asked before several Device Inventory rows are folded into one.
 *
 * The inventory only matches devices when a row is created, so two rows for one
 * host — minted before either carried the address that would have matched them
 * — never converge on their own. This is where the user says they are the same
 * machine and picks which row survives.
 *
 * Nothing is thrown away by the merge itself: the survivor keeps every fact it
 * has and fills its gaps from the others, and canvas nodes, rack mounts and
 * documents are re-pointed at it. The one thing the user must choose is which
 * id (and so which of two *conflicting* values) stands.
 */
export function MergeDevicesModal({ open, devices, onCancel, onConfirm, busy = false }: MergeDevicesModalProps) {
  // Only the user's override is state. The winner is otherwise derived, so a
  // choice held over from a previous selection — a row that no longer exists —
  // falls back to the suggestion instead of pointing at nothing.
  const [picked, setPicked] = useState<string | undefined>(undefined)

  if (devices.length < 2) return null

  const winnerId = devices.some((d) => d.id === picked) ? picked : suggestWinner(devices)
  const winner = devices.find((d) => d.id === winnerId)

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="bg-[#161b22] border-border max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-foreground flex items-center gap-2">
            <Merge size={16} style={{ color: ACCENT }} />
            Merge {devices.length} devices into one
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <p className="text-xs text-muted-foreground">
            Keep which row? The others fold into it — their facts fill its gaps, and every
            canvas node, rack mount and document they own moves across.
          </p>

          <div className="max-h-[50vh] overflow-y-auto space-y-1.5">
            {devices.map((d) => (
              <label
                key={d.id}
                className={`flex items-start gap-2 rounded-md border px-3 py-2 text-xs cursor-pointer transition-colors ${
                  d.id === winnerId
                    ? 'border-[#00d4ff]/50 bg-[#00d4ff]/10'
                    : 'border-border bg-[#0d1117]/60 hover:border-muted-foreground/40'
                }`}
              >
                <input
                  type="radio"
                  name="merge-winner"
                  checked={d.id === winnerId}
                  onChange={() => setPicked(d.id)}
                  className="mt-0.5 cursor-pointer shrink-0"
                  style={{ accentColor: ACCENT }}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="text-foreground font-medium truncate">{deviceName(d)}</span>
                    {(d.canvas_count ?? 0) > 0 && (
                      <span className="flex items-center gap-1 text-[10px] text-[#00d4ff] shrink-0">
                        <Layers size={10} />
                        {d.canvas_count}
                      </span>
                    )}
                  </span>
                  <span className="block text-[11px] text-muted-foreground font-mono break-all">
                    {[d.ip, d.mac, d.ieee_address].filter(Boolean).join(' · ') || 'no address'}
                  </span>
                  <span className="block text-[11px] text-muted-foreground">
                    {factCount(d)} fact{factCount(d) !== 1 ? 's' : ''}
                    {d.services?.length ? ` · ${d.services.length} service${d.services.length !== 1 ? 's' : ''}` : ''}
                  </span>
                </span>
              </label>
            ))}
          </div>

          <p className="text-[11px] text-muted-foreground">
            {winner
              ? `Merging cannot be undone. ${devices.length - 1} row${devices.length - 1 !== 1 ? 's' : ''} will be deleted once their facts and links are on ${deviceName(winner)}.`
              : 'Pick the row to keep.'}
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => winnerId && onConfirm(winnerId)}
            disabled={!winnerId || busy}
            style={{ backgroundColor: `${ACCENT}33`, color: ACCENT }}
          >
            {busy ? 'Merging…' : `Merge into ${winner ? deviceName(winner) : 'this row'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

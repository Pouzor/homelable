import { useState } from 'react'
import { Server, Box, Container, Plus } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import type { InventoryEntry } from '@/types'
import type { ProxmoxCanvasMode } from '@/components/proxmox/types'

/** The import that recorded the host's guests decides the wording and colour. */
export type GuestHostSource = 'proxmox' | 'unraid'

const SOURCE_COPY: Record<GuestHostSource, { accent: string; noun: string; detail: string }> = {
  proxmox: {
    accent: '#e57000',
    noun: 'guest',
    detail: 'VMs and LXC containers this host runs, as recorded by the Proxmox import.',
  },
  unraid: {
    accent: '#e22828',
    noun: 'container',
    detail: 'Docker containers this server runs, as recorded by the Unraid import.',
  },
}

export interface ProxmoxApproveChoice {
  /** Guest inventory ids to place alongside the host. Empty = host only. */
  childIds: string[]
  mode: ProxmoxCanvasMode
}

interface ProxmoxApproveModalProps {
  open: boolean
  host: InventoryEntry | null
  /** Guests the host runs, from `scanApi.proxmoxChildren`. Deliberately not
   * named `children` — React would treat the array as renderable child nodes. */
  guests: InventoryEntry[]
  /** Unraid containers are always drawn linked, never nested. */
  source?: GuestHostSource
  onCancel: () => void
  onConfirm: (choice: ProxmoxApproveChoice) => void
}

function label(d: InventoryEntry): string {
  return d.label ?? d.friendly_name ?? d.hostname ?? d.ip ?? d.ieee_address ?? 'device'
}

/**
 * Asked before a Proxmox host from the Device Inventory reaches a canvas: bring
 * its VMs/LXCs along, and if so draw them nested inside the host
 * (`container_mode`) or as separate nodes joined by virtual edges. An Unraid
 * server gets the same question about its containers, always drawn linked.
 *
 * Only shown when the host actually has guests in the inventory — a host with
 * none is approved straight away.
 */
export function ProxmoxApproveModal({
  open,
  host,
  guests,
  source = 'proxmox',
  onCancel,
  onConfirm,
}: ProxmoxApproveModalProps) {
  const [includeChildren, setIncludeChildren] = useState(true)
  const [mode, setMode] = useState<ProxmoxCanvasMode>('container')

  if (!host) return null

  const { accent, noun, detail } = SOURCE_COPY[source]
  const canNest = source === 'proxmox'

  const confirm = () => {
    onConfirm({
      childIds: includeChildren ? guests.map((c) => c.id) : [],
      mode: includeChildren && canNest ? mode : 'linked',
    })
    // Next host starts from the defaults again.
    setIncludeChildren(true)
    setMode('container')
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="bg-[#161b22] border-border max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-foreground flex items-center gap-2">
            <Server size={16} style={{ color: accent }} />
            Add {label(host)} to canvas
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <label className="flex items-start gap-2 rounded-md border border-border bg-[#0d1117]/60 px-3 py-2.5 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={includeChildren}
              onChange={(e) => setIncludeChildren(e.target.checked)}
              className="w-3 h-3 mt-0.5 cursor-pointer shrink-0"
              style={{ accentColor: accent }}
            />
            <span>
              <span className="block text-foreground">
                Also add its {guests.length} {noun}{guests.length !== 1 ? 's' : ''}
              </span>
              <span className="block text-[11px] text-muted-foreground">{detail}</span>
            </span>
          </label>

          {includeChildren && canNest && (
            <div className="space-y-2 rounded-md border border-border bg-[#0d1117]/60 px-3 py-2.5">
              <span className="block text-xs text-muted-foreground">Draw the guests as</span>
              <label className="flex items-start gap-2 text-xs cursor-pointer text-foreground">
                <input
                  type="radio"
                  name="proxmox-approve-mode"
                  checked={mode === 'container'}
                  onChange={() => setMode('container')}
                  className="mt-0.5 cursor-pointer shrink-0"
                  style={{ accentColor: accent }}
                />
                <span>
                  Nested inside the host
                  <span className="block text-[11px] text-muted-foreground">
                    Container mode — the host becomes a box holding its guests.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-xs cursor-pointer text-foreground">
                <input
                  type="radio"
                  name="proxmox-approve-mode"
                  checked={mode === 'linked'}
                  onChange={() => setMode('linked')}
                  className="mt-0.5 cursor-pointer shrink-0"
                  style={{ accentColor: accent }}
                />
                <span>
                  Separate nodes linked to the host
                  <span className="block text-[11px] text-muted-foreground">
                    Guests sit beside the host, joined by virtual edges.
                  </span>
                </span>
              </label>
            </div>
          )}

          {includeChildren && guests.length > 0 && (
            <div className="max-h-48 overflow-y-auto space-y-1">
              {guests.map((c) => {
                const type = (c.type ?? c.suggested_type) ?? 'vm'
                const Icon = type === 'lxc' || type === 'docker_container' ? Container : Box
                const color = type === 'lxc' ? '#39d353' : '#00d4ff'
                return (
                  <div
                    key={c.id}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-[#21262d] text-xs"
                  >
                    <Icon size={12} style={{ color }} className="shrink-0" />
                    <span className="text-foreground truncate">{label(c)}</span>
                    {c.ip && (
                      <span className="font-mono text-[10px] text-muted-foreground truncate ml-auto">
                        {c.ip}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button
            onClick={confirm}
            style={{ background: accent, color: '#0d1117' }}
            className="gap-1.5"
          >
            <Plus size={13} />
            Add {includeChildren ? guests.length + 1 : 1} to canvas
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

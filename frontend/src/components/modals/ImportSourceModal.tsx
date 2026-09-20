import { Network, RadioTower, Server, Wifi, ArrowRight, Clock } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { brandIconUrl } from '@/utils/nodeIcons'

export type ImportSourceKey = 'zigbee' | 'zwave' | 'proxmox' | 'unifi'

interface ImportSourceModalProps {
  open: boolean
  onClose: () => void
  onPick: (source: ImportSourceKey) => void
}

interface ImportSource {
  key: ImportSourceKey
  /** Product name, not the canvas vocabulary — this is what the user runs. */
  label: string
  /** dashboard-icons slug; the lucide icon is the fallback when it fails to load. */
  brandSlug: string
  fallbackIcon: LucideIcon
  accent: string
  description: string
  /** Rough wall-clock for a typical homelab — sets the expectation, not a promise. */
  duration: string
  /** What makes the range a range, when the spread is wide enough to explain. */
  durationNote?: string
  /** What lands in the inventory / on the canvas. */
  imports: string[]
  dataTour?: string
}

const SOURCES: ImportSource[] = [
  {
    key: 'zigbee',
    label: 'Zigbee2MQTT',
    brandSlug: 'zigbee2mqtt',
    fallbackIcon: Network,
    accent: '#00d4ff',
    description: 'Reads the coordinator over MQTT and brings the whole mesh in, routers and end devices alike.',
    duration: '30 s – a few min',
    durationNote: 'with the mesh size',
    imports: ['Devices', 'Mesh links'],
    dataTour: 'import-zigbee',
  },
  {
    key: 'zwave',
    label: 'Z-Wave JS',
    brandSlug: 'z-wave-js-ui',
    fallbackIcon: RadioTower,
    accent: '#ff6e00',
    description: 'Pulls the Z-Wave JS UI node list with each node’s neighbours, so the mesh keeps its shape.',
    duration: '30 s – a few min',
    durationNote: 'with the mesh size',
    imports: ['Nodes', 'Neighbours'],
  },
  {
    key: 'proxmox',
    label: 'Proxmox VE',
    brandSlug: 'proxmox',
    fallbackIcon: Server,
    accent: '#e57000',
    description: 'Queries the API for every node of the cluster and the guests running on them.',
    duration: '~10 s',
    imports: ['Hosts', 'VMs', 'LXC'],
  },
  {
    key: 'unifi',
    label: 'UniFi',
    brandSlug: 'unifi',
    fallbackIcon: Wifi,
    accent: '#0559c9',
    description: 'Talks to the controller for adopted gear, and optionally for the clients it sees.',
    duration: '~20 s',
    imports: ['Gateways', 'Switches', 'APs', 'Clients'],
  },
]

/**
 * The one entry point for every import. The sources are picked here rather than
 * listed in the sidebar: the list only grows, and a stack of near-identical
 * links reads worse the longer it gets.
 */
export function ImportSourceModal({ open, onClose, onPick }: ImportSourceModalProps) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      {/* The dialog primitive pins `sm:max-w-sm`, and a variant utility outranks
          every plain `max-w-*` class — only an inline width actually widens it,
          and four tiles need the room. */}
      <DialogContent
        className="bg-[#161b22] border-border max-h-[85vh] flex flex-col"
        style={{ maxWidth: 'min(1120px, calc(100vw - 3rem))' }}
      >
        <DialogHeader>
          <DialogTitle className="text-foreground">Import from…</DialogTitle>
          <DialogDescription>
            Pick a source to pull devices from. Everything lands in the Device Inventory first — nothing
            touches the canvas until you approve it.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0 py-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {SOURCES.map((source) => (
              <ImportSourceTile key={source.key} source={source} onPick={() => onPick(source.key)} />
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ImportSourceTile({ source, onPick }: { source: ImportSource; onPick: () => void }) {
  const Fallback = source.fallbackIcon

  return (
    <button
      type="button"
      onClick={onPick}
      data-tour={source.dataTour}
      aria-label={`Import from ${source.label}`}
      className="group relative flex flex-col gap-3 rounded-lg border border-border bg-[#21262d] p-4 text-left transition-colors cursor-pointer hover:bg-[#2a313a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00d4ff]"
    >
      {/* The accent only shows on hover/focus — four saturated brand colors side
          by side fight each other at rest. */}
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 h-0.5 rounded-t-lg opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
        style={{ backgroundColor: source.accent }}
      />

      <div className="flex items-center justify-between">
        <span
          className="flex h-11 w-11 items-center justify-center rounded-md"
          style={{ backgroundColor: `${source.accent}1a` }}
        >
          <BrandGlyph slug={source.brandSlug} accent={source.accent} fallback={Fallback} />
        </span>
        <ArrowRight
          size={16}
          className="text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
        />
      </div>

      <div className="space-y-1">
        <div className="text-sm font-medium text-foreground">{source.label}</div>
        <p className="text-xs leading-relaxed text-muted-foreground">{source.description}</p>
      </div>

      <div className="mt-auto space-y-2 pt-1">
        <div className="flex flex-wrap gap-1">
          {source.imports.map((item) => (
            <span
              key={item}
              className="rounded border border-border bg-[#161b22] px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
            >
              {item}
            </span>
          ))}
        </div>
        <div className="flex items-start gap-1 text-[11px] text-muted-foreground">
          <Clock size={11} className="mt-0.5 shrink-0" />
          <span>
            {source.duration}
            {source.durationNote && <span className="text-muted-foreground/70"> · {source.durationNote}</span>}
          </span>
        </div>
      </div>
    </button>
  )
}

/**
 * The brand logos come from the dashboard-icons CDN, which is offline in
 * standalone-ish setups and blocked on some networks — swap in the lucide icon
 * rather than leaving a broken image in the tile.
 */
function BrandGlyph({ slug, accent, fallback: Fallback }: { slug: string; accent: string; fallback: LucideIcon }) {
  return (
    <>
      <img
        src={brandIconUrl(slug)}
        alt=""
        width={24}
        height={24}
        loading="lazy"
        style={{ width: 24, height: 24, objectFit: 'contain' }}
        onError={(e) => {
          const img = e.currentTarget
          img.style.display = 'none'
          img.nextElementSibling?.removeAttribute('hidden')
        }}
      />
      <span hidden>
        <Fallback size={22} style={{ color: accent }} />
      </span>
    </>
  )
}

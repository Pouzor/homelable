/**
 * Visual faceplate catalog.
 *
 * A plate is a drawing, not a name: "Switch 24 ports + 2 SFP" tells you far less
 * than seeing the plate. The picker renders every template with the same
 * component the canvas uses, at its real relative width (a half-width plate
 * draws half as wide) and a height proportional to its U count, so sizes compare
 * honestly against each other.
 */
import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Faceplate } from './Faceplate'
import { faceplateGroups } from '../faceplates'
import { useRackPalette } from '../rackTheme'
import { RACK_COLUMNS, type FaceplateKind, type FaceplateTemplate, type Port } from '@/types'

/** Pixel width of a full-width plate in the preview strip. */
const PREVIEW_WIDTH = 400
/** Pixel height of one U in the preview strip. */
const PREVIEW_U = 34
/**
 * The strip hugs the plate — a 1U plate in a 4U-tall box reads as a speck. Tall
 * plates simply make their tile taller, which is the honest cue anyway.
 */
const PREVIEW_MIN = 2 * PREVIEW_U

const WIDTH_LABEL: Record<number, string> = {
  [RACK_COLUMNS]: 'Full width',
  [RACK_COLUMNS / 2]: 'Half width',
  [RACK_COLUMNS / 3]: 'Third width',
  [RACK_COLUMNS / 4]: 'Quarter width',
  [RACK_COLUMNS / 6]: 'Sixth width',
}

/** Ports carry no id in a template — seed stable ones for the preview only. */
function previewPorts(plate: FaceplateTemplate): Port[] {
  return plate.ports.map((p, i) => ({ ...p, id: `${plate.id}-${i}` }))
}

function matches(plate: FaceplateTemplate, query: string): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  return plate.label.toLowerCase().includes(q) || plate.group.toLowerCase().includes(q)
}

interface TileProps {
  plate: FaceplateTemplate
  selected: boolean
  onPick: (id: string) => void
}

function FaceplateTile({ plate, selected, onPick }: TileProps) {
  const palette = useRackPalette()
  const ports = useMemo(() => previewPorts(plate), [plate])

  return (
    <button
      type="button"
      aria-label={plate.label}
      aria-pressed={selected}
      onClick={() => onPick(plate.id)}
      className={`flex cursor-pointer flex-col gap-2 rounded border p-2 text-left transition-colors ${
        selected
          ? 'border-[#00d4ff] bg-[#00d4ff11]'
          : 'border-[#30363d] hover:border-[#00d4ff66] hover:bg-[#21262d]'
      }`}
    >
      <div
        className="flex items-center justify-center rounded p-2"
        style={{ background: palette.canvas, minHeight: PREVIEW_MIN }}
      >
        {/* The plate is drawn at a nominal size, then scaled to the tile by CSS:
            an SVG is a flex item and would otherwise be shrunk, never grown. A
            sub-width plate keeps its fraction of the strip, so widths compare. */}
        <div
          className="[&>svg]:h-auto [&>svg]:w-full"
          style={{ width: `${(100 * plate.colSpan) / RACK_COLUMNS}%` }}
        >
          <Faceplate
            faceplateId={plate.id}
            label={plate.label}
            status="unknown"
            ports={ports}
            width={(PREVIEW_WIDTH * plate.colSpan) / RACK_COLUMNS}
            height={plate.uHeight * PREVIEW_U}
            revealed
          />
        </div>
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="text-xs text-foreground">{plate.label}</span>
        <span className="font-mono text-[10px] text-muted-foreground">
          {plate.uHeight}U · {WIDTH_LABEL[plate.colSpan] ?? `${plate.colSpan}/${RACK_COLUMNS}`} ·{' '}
          {plate.ports.length} port{plate.ports.length === 1 ? '' : 's'}
        </span>
      </div>
    </button>
  )
}

interface Props {
  open: boolean
  /** Currently applied plate, highlighted in the grid. */
  value: string
  /** Restrict the catalog — accessories are rack furniture, not devices. */
  kind?: FaceplateKind
  onPick: (id: string) => void
  onClose: () => void
}

export function FaceplatePicker({ open, value, kind, onPick, onClose }: Props) {
  const [query, setQuery] = useState('')

  const groups = useMemo(
    () =>
      faceplateGroups()
        .map(({ group, items }) => ({
          group,
          items: items.filter((p) => (!kind || p.kind === kind) && matches(p, query)),
        }))
        .filter((g) => g.items.length > 0),
    [kind, query],
  )

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      {/* `sm:max-w-sm` on the shared DialogContent is media-scoped, so it beats a
          plain `max-w-*` here — the override has to carry the same prefix. */}
      <DialogContent className="w-[96vw] max-w-[96vw] sm:max-w-[1440px] border-[#30363d] bg-[#161b22] text-foreground max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold">Choose a faceplate</DialogTitle>
        </DialogHeader>

        <div className="relative">
          <Search
            size={13}
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            autoFocus
            aria-label="Search faceplates"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or category…"
            className="w-full rounded border border-[#30363d] bg-[#21262d] py-1 pl-7 pr-2 text-sm text-foreground outline-none focus:border-[#00d4ff]"
          />
        </div>

        <div className="flex flex-col gap-4">
          {groups.map(({ group, items }) => (
            <section key={group} className="flex flex-col gap-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {group}
              </h3>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((plate) => (
                  <FaceplateTile
                    key={plate.id}
                    plate={plate}
                    selected={plate.id === value}
                    onPick={(id) => {
                      onPick(id)
                      onClose()
                    }}
                  />
                ))}
              </div>
            </section>
          ))}
          {groups.length === 0 && (
            <p className="py-6 text-center text-xs text-muted-foreground">
              No faceplate matches “{query}”.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

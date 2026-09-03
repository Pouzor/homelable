/**
 * The port list of one faceplate: name, type, remove, and the switch into
 * placement mode.
 *
 * Shared by the rack canvas' device modal and the Device Inventory detail modal
 * — a device's ports belong to its inventory row, so both edit the same list and
 * must offer the same editor.
 */
import { Move, Plus, X } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { nextPortSpot } from '../portLayout'
import { generateUUID } from '@/utils/uuid'
import type { Port, PortType } from '@/types'

const PORT_TYPES: PortType[] = ['rj45', 'sfp', 'sfp+']

interface Props {
  ports: Port[]
  onChange: (ports: Port[]) => void
  /** Placement mode, owned by the parent: the plate it drives lives there. */
  positioning: boolean
  onPositioningChange: (positioning: boolean) => void
  /** Highlighted port, shared with the plate. */
  selectedPortId: string | null
  onSelect: (portId: string | null) => void
}

export function PortListEditor({
  ports,
  onChange,
  positioning,
  onPositioningChange,
  selectedPortId,
  onSelect,
}: Props) {
  const patch = (portId: string, fields: Partial<Port>) =>
    onChange(ports.map((p) => (p.id === portId ? { ...p, ...fields } : p)))

  const add = () => {
    // A new port continues the last row instead of landing on the middle of the
    // plate, under the one before it.
    const port: Port = {
      id: generateUUID(),
      label: `p${ports.length + 1}`,
      type: 'rj45',
      ...nextPortSpot(ports),
    }
    onSelect(port.id)
    onChange([...ports, port])
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-xs text-muted-foreground">Ports ({ports.length})</Label>
        <div className="flex items-center gap-1">
          {/* Placing a port is a mode, not a field: the plate takes the pointer
              while it is on. */}
          <button
            type="button"
            aria-label="Position ports"
            aria-pressed={positioning}
            disabled={ports.length === 0}
            className={`cursor-pointer rounded border px-2 py-0.5 text-xs disabled:cursor-not-allowed disabled:opacity-40 ${
              positioning
                ? 'border-[#00d4ff] text-[#00d4ff]'
                : 'border-[#30363d] hover:border-[#00d4ff]'
            }`}
            onClick={() => onPositioningChange(!positioning)}
          >
            <Move size={12} className="inline" /> Position
          </button>
          <button
            type="button"
            aria-label="Add port"
            className="cursor-pointer rounded border border-[#30363d] px-2 py-0.5 text-xs hover:border-[#00d4ff]"
            onClick={add}
          >
            <Plus size={12} className="inline" /> Add
          </button>
        </div>
      </div>
      {/* Two columns of one-line chips: a 24-port switch used to draw 24 full
          rows of full-height inputs, so the list ran a metre down the modal and
          buried everything under it. Name, type and remove all fit on one 28px
          line, and two columns halve the scroll again. */}
      <ul className="grid max-h-[19rem] grid-cols-2 gap-1 overflow-y-auto pr-0.5">
        {ports.map((port) => (
          <li
            key={port.id}
            // Editing or clicking a port highlights it on the plate — and, in
            // placement mode, the arrow keys then move that one.
            onFocusCapture={() => onSelect(port.id)}
            onClick={() => onSelect(port.id)}
            className={`flex h-7 items-center gap-0.5 rounded border bg-[#1c2128] pr-0.5 ${
              selectedPortId === port.id ? 'border-[#00d4ff]' : 'border-[#30363d]'
            }`}
          >
            <input
              // Borderless inside the chip: a box drawn inside a box is what
              // made the old rows twice as tall as they needed to be.
              className="h-6 min-w-0 flex-1 bg-transparent px-1.5 text-xs text-foreground outline-none"
              aria-label={`Port ${port.label} label`}
              placeholder="Name"
              value={port.label}
              onChange={(e) => patch(port.id, { label: e.target.value })}
            />
            <select
              className="h-6 shrink-0 cursor-pointer rounded bg-transparent text-[11px] text-muted-foreground outline-none hover:text-foreground"
              aria-label={`Port ${port.label} type`}
              value={port.type}
              onChange={(e) => patch(port.id, { type: e.target.value as PortType })}
            >
              {PORT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <button
              type="button"
              aria-label={`Remove port ${port.label}`}
              className="cursor-pointer px-0.5 text-muted-foreground hover:text-[#f85149]"
              onClick={() => onChange(ports.filter((p) => p.id !== port.id))}
            >
              <X size={11} />
            </button>
          </li>
        ))}
        {ports.length === 0 && (
          <li className="col-span-2 text-[11px] text-muted-foreground">No port on this plate.</li>
        )}
      </ul>
    </div>
  )
}

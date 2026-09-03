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

const inputBase =
  'rounded border border-[#30363d] bg-[#21262d] px-2 py-1 text-sm text-foreground outline-none focus:border-[#00d4ff]'

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
      <ul className="max-h-[26rem] space-y-1 overflow-y-auto">
        {ports.map((port) => (
          <li
            key={port.id}
            // Editing a port's name highlights it on the plate, so the list and
            // the drawing never disagree about which port is which.
            onFocusCapture={() => onSelect(port.id)}
            className={`flex items-center gap-1 rounded border px-1 py-1 ${
              selectedPortId === port.id ? 'border-[#00d4ff] bg-[#00d4ff0f]' : 'border-transparent'
            }`}
          >
            <input
              // Without min-w-0 the flex row lets the type select win the space
              // and the name field collapses into an unlabelled box.
              className={`${inputBase} min-w-0 flex-1`}
              aria-label={`Port ${port.label} label`}
              placeholder="Port name"
              value={port.label}
              onChange={(e) => patch(port.id, { label: e.target.value })}
            />
            <select
              className={`${inputBase} w-24 shrink-0`}
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
              className="cursor-pointer px-1 text-xs text-muted-foreground hover:text-[#f85149]"
              onClick={() => onChange(ports.filter((p) => p.id !== port.id))}
            >
              <X size={12} />
            </button>
          </li>
        ))}
        {ports.length === 0 && (
          <li className="text-[11px] text-muted-foreground">No port on this plate.</li>
        )}
      </ul>
    </div>
  )
}

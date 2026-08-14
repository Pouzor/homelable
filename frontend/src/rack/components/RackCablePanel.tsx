/**
 * Right rail for the selected cable.
 *
 * The rack canvas has no rail for mounted gear — a mount is edited in its own
 * modal — but a cable has no plate to double-click, so clicking the run opens
 * this panel instead. It carries the physical facts (type, colour, label) and
 * the same free-form property records the logical canvas uses for nodes, each
 * with its own "show it on the canvas" toggle.
 */
import { useState } from 'react'
import { Cable as CableIcon, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PropertyList } from '@/components/common/PropertyList'
import { CABLE_COLOR_PRESETS, CABLE_COLORS, CABLE_PROPERTY_SUGGESTIONS } from '../rackDefaults'
import { useRackStore } from '../store'
import type { CableProperty, CableType, RackDevice } from '@/types'

const TYPE_LABELS: Record<CableType, string> = {
  ethernet: 'Ethernet',
  fiber: 'Fibre',
}

export function RackCablePanel() {
  const cables = useRackStore((s) => s.cables)
  const devices = useRackStore((s) => s.devices)
  const selectedCableId = useRackStore((s) => s.selectedCableId)
  const updateCable = useRackStore((s) => s.updateCable)
  const removeCable = useRackStore((s) => s.removeCable)
  const selectCable = useRackStore((s) => s.selectCable)

  const cable = cables.find((c) => c.id === selectedCableId)
  if (!cable) return null

  const endpoint = (ref: { deviceId: string; portId: string }) => {
    const device: RackDevice | undefined = devices.find((d) => d.id === ref.deviceId)
    return {
      device: device?.label ?? 'Unknown device',
      port: device?.ports.find((p) => p.id === ref.portId)?.label ?? '—',
    }
  }

  const from = endpoint(cable.from)
  const to = endpoint(cable.to)
  const properties: CableProperty[] = cable.properties ?? []

  const handleType = (type: CableType) => {
    if (type === cable.type) return
    // Recolour only a cable still wearing its type's default, so a colour the
    // user picked survives a type change.
    const patch =
      cable.color === CABLE_COLORS[cable.type] ? { type, color: CABLE_COLORS[type] } : { type }
    updateCable(cable.id, patch)
  }

  return (
    <aside className="w-72 shrink-0 flex flex-col border-l border-border bg-[#161b22] overflow-y-auto">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <span className="flex items-center gap-2 min-w-0 font-semibold text-sm text-foreground">
          <CableIcon size={14} className="shrink-0" style={{ color: cable.color }} />
          <span className="truncate">{cable.label?.trim() || 'Cable'}</span>
        </span>
        <button
          aria-label="Close panel"
          onClick={() => selectCable(null)}
          className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        >
          <X size={16} />
        </button>
      </div>

      {/* Endpoints */}
      <div className="flex flex-col gap-2 px-4 py-3 border-b border-border">
        <span className="text-xs text-muted-foreground">Endpoints</span>
        <EndpointRow side="A" device={from.device} port={from.port} />
        <EndpointRow side="B" device={to.device} port={to.port} />
      </div>

      {/* Type */}
      <div className="px-4 py-3 border-b border-border">
        <span className="text-xs text-muted-foreground">Type</span>
        <div className="mt-2 flex gap-1.5">
          {(Object.keys(TYPE_LABELS) as CableType[]).map((type) => (
            <button
              key={type}
              onClick={() => handleType(type)}
              className={`flex-1 rounded border px-2 py-1 text-[11px] transition-colors cursor-pointer ${
                cable.type === type
                  ? 'border-[#00d4ff] bg-[#00d4ff]/10 text-[#00d4ff]'
                  : 'border-[#30363d] text-muted-foreground hover:border-[#8b949e]'
              }`}
            >
              {TYPE_LABELS[type]}
            </button>
          ))}
        </div>
      </div>

      {/* Colour */}
      <div className="px-4 py-3 border-b border-border">
        <span className="text-xs text-muted-foreground">Colour</span>
        <div className="mt-2 flex flex-wrap gap-1">
          {CABLE_COLOR_PRESETS.map((color) => (
            <button
              key={color}
              aria-label={`Cable colour ${color}`}
              title={color}
              onClick={() => updateCable(cable.id, { color })}
              className={`h-6 w-6 rounded border transition-transform cursor-pointer hover:scale-110 ${
                cable.color.toLowerCase() === color.toLowerCase() ? 'border-[#00d4ff]' : 'border-[#30363d]'
              }`}
              style={{ background: color }}
            />
          ))}
        </div>
        <HexField
          value={cable.color}
          fallback={CABLE_COLORS[cable.type]}
          onCommit={(color) => updateCable(cable.id, { color })}
        />
      </div>

      {/* Label */}
      <div className="px-4 py-3 border-b border-border">
        <span className="text-xs text-muted-foreground">Label</span>
        <Input
          value={cable.label ?? ''}
          onChange={(e) => updateCable(cable.id, { label: e.target.value })}
          aria-label="Cable label"
          placeholder="e.g. Uplink to core"
          className="mt-2 bg-[#21262d] border-[#30363d] text-xs h-7"
        />
        <label className="mt-2 flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={cable.labelVisible === true}
            onChange={(e) => updateCable(cable.id, { labelVisible: e.target.checked })}
            className="accent-[#00d4ff] w-3 h-3"
          />
          <span className="text-[10px] text-muted-foreground">Show on canvas</span>
        </label>
      </div>

      <PropertyList
        properties={properties}
        onChange={(next) => updateCable(cable.id, { properties: next })}
        visibleLabel="Show on canvas"
        keyPlaceholder="Label (e.g. Length)"
        valuePlaceholder="Value — optional (e.g. 2 m)"
        suggestions={CABLE_PROPERTY_SUGGESTIONS}
        emptyHint="No properties — add a length, a VLAN, whatever this run needs."
      />

      <div className="px-4 py-3 border-t border-border mt-auto">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => removeCable(cable.id)}
          className="w-full h-7 text-[11px] text-[#f85149] hover:text-[#f85149] hover:bg-[#f85149]/10"
        >
          <Trash2 size={12} className="mr-1.5" /> Unplug cable
        </Button>
      </div>
    </aside>
  )
}

/**
 * Free-text colour, committed on blur or Enter once it parses.
 *
 * Writing every keystroke into `cable.color` fed partial values (`#39d`) to the
 * SVG `stroke`, and the run stopped rendering with no feedback. An unparseable
 * value falls back to the cable type's default rather than leaving an invisible
 * cable behind.
 */
function HexField({ value, fallback, onCommit }: {
  value: string
  fallback: string
  onCommit: (color: string) => void
}) {
  const [draft, setDraft] = useState(value)

  // Follow a colour set elsewhere (a swatch, a type change). Adjusted during
  // render, not in an effect, so the field never shows the stale value first.
  const [seen, setSeen] = useState(value)
  if (seen !== value) {
    setSeen(value)
    setDraft(value)
  }

  const commit = () => {
    const next = draft.trim()
    const valid = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(next)
    const color = valid ? next : fallback
    setDraft(color)
    if (color !== value) onCommit(color)
  }

  return (
    <Input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') setDraft(value)
      }}
      aria-label="Cable colour hex"
      placeholder="#39d353"
      className="mt-2 bg-[#21262d] border-[#30363d] text-xs h-7 font-mono"
    />
  )
}

function EndpointRow({ side, device, port }: { side: string; device: string; port: string }) {
  return (
    <div className="flex items-baseline gap-2 min-w-0">
      <span className="w-3 shrink-0 text-[10px] text-muted-foreground">{side}</span>
      <span className="truncate text-xs text-foreground" title={device}>{device}</span>
      <span className="ml-auto shrink-0 font-mono text-[11px] text-[#00d4ff]" title={port}>{port}</span>
    </div>
  )
}

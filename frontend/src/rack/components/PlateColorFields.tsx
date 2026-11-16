/**
 * The colours of a faceplate: its panel, its label, and — on plates that have
 * one — the port bay the sockets sit in.
 *
 * Shared by the rack's device modal and the Device Inventory's faceplate editor,
 * which edit the same front panel from two places. Each row shows what the plate
 * is actually drawn with: an unset colour reads "Auto" next to the swatch the
 * renderer resolves it to, so the user picks from where the plate already is.
 */
import { RotateCcw } from 'lucide-react'
import { getFaceplate, hasPortBay } from '../faceplates'
import { plateTextColor } from '../plateColors'
import { useRackPalette } from '../rackTheme'

export interface PlateColors {
  color: string | null
  textColor: string | null
  bayColor: string | null
}

interface RowProps {
  name: string
  /** Accessible name of the colour input. */
  inputLabel: string
  /** Accessible name of the reset button; omitted, the visible "Reset" names it. */
  resetLabel?: string
  value: string | null
  /** What the plate is drawn with while `value` is unset. */
  fallback: string
  onChange: (value: string | null) => void
}

/** The native picker only takes `#rrggbb`; a stored `#rgb` is widened for it. */
function pickerValue(color: string): string {
  return /^#[0-9a-f]{3}$/i.test(color) ? color.replace(/[0-9a-f]/gi, (c) => c + c) : color
}

function ColorRow({ name, inputLabel, resetLabel, value, fallback, onChange }: RowProps) {
  const shown = value ?? fallback
  return (
    <div className="flex h-9 items-center gap-3 rounded-md border border-border bg-background px-2.5">
      <span className="w-16 shrink-0 text-xs text-muted-foreground">{name}</span>
      {/* The swatch is the control: the native input sits over it, invisible,
          so the click opens the system picker without the browser's own chrome. */}
      <span
        className="relative h-5 w-5 shrink-0 overflow-hidden rounded-full border border-white/20 shadow-inner"
        style={{ backgroundColor: shown }}
      >
        <input
          type="color"
          aria-label={inputLabel}
          value={pickerValue(shown)}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </span>
      <span
        className={`truncate font-mono text-xs ${value ? 'text-foreground' : 'text-muted-foreground'}`}
      >
        {value ?? 'Auto'}
      </span>
      {value && (
        <button
          type="button"
          aria-label={resetLabel}
          title="Back to automatic"
          onClick={() => onChange(null)}
          className="ml-auto flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <RotateCcw size={11} />
          Reset
        </button>
      )}
    </div>
  )
}

export function PlateColorFields({
  faceplateId,
  value,
  onChange,
}: {
  faceplateId: string
  value: PlateColors
  onChange: (patch: Partial<PlateColors>) => void
}) {
  const palette = useRackPalette()
  const template = getFaceplate(faceplateId)
  const panel = template.elements.find((e) => e.kind === 'panel')
  const strip = template.elements.find((e) => e.kind === 'strip')
  const defaultFill = panel?.kind === 'panel' ? panel.fill : palette.plate
  const fill = value.color ?? defaultFill

  return (
    <div className="flex flex-col gap-1.5">
      <ColorRow
        name="Panel"
        inputLabel="Colour override"
        value={value.color}
        fallback={defaultFill}
        onChange={(color) => onChange({ color })}
      />
      <ColorRow
        name="Label"
        inputLabel="Label colour"
        resetLabel="Reset label colour"
        value={value.textColor}
        // Auto follows the panel: recolour it and the label ink follows.
        fallback={plateTextColor(fill, palette.text)}
        onChange={(textColor) => onChange({ textColor })}
      />
      {hasPortBay(faceplateId) && strip?.kind === 'strip' && (
        <ColorRow
          name="Port bay"
          inputLabel="Port bay colour"
          resetLabel="Reset port bay colour"
          value={value.bayColor}
          fallback={strip.fill}
          onChange={(bayColor) => onChange({ bayColor })}
        />
      )}
    </div>
  )
}

/**
 * A device's rack modelisation, edited away from any rack.
 *
 * The Device Inventory row owns the front panel — plate, size, colour and ports
 * — so it has to be editable from the inventory itself, not only from a mount on
 * a rack canvas. Same plate catalog, same port list, same placement mode as
 * `RackDeviceModal`; what is missing here is everything that belongs to a mount
 * (which rack, which U, which column), because a device has none of that until
 * it is racked.
 */
import { useState } from 'react'
import { Label } from '@/components/ui/label'
import { FaceplatePicker } from './FaceplatePicker'
import { PortListEditor } from './PortListEditor'
import { PortPositionEditor } from './PortPositionEditor'
import { PlateColorFields } from './PlateColorFields'
import { getFaceplate } from '../faceplates'
import { MAX_RACK_U } from '../rackDefaults'
import type { DeviceRackModel } from '../deviceRackModel'
import { RACK_COLUMNS, type DeviceStatus } from '@/types'

const inputClass =
  'w-full rounded border border-border bg-secondary px-2 py-1 text-sm text-foreground outline-none focus:border-primary'
const fieldLabel = 'text-xs text-muted-foreground'

interface Props {
  value: DeviceRackModel
  /** Printed on the plate, like the mount's label on a rack. */
  label: string
  status: DeviceStatus
  /** Read-only outside the detail modal's edit mode. */
  editable: boolean
  onChange: (model: DeviceRackModel) => void
}

export function DeviceFaceplateEditor({ value, label, status, editable, onChange }: Props) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [positioning, setPositioning] = useState(false)
  const [selectedPortId, setSelectedPortId] = useState<string | null>(null)

  const plate = getFaceplate(value.faceplateId)

  /** Swapping the plate reseeds its size; the ports stay, they are the device's. */
  const pickFaceplate = (id: string) => {
    const picked = getFaceplate(id)
    onChange({ ...value, faceplateId: picked.id, uHeight: picked.uHeight, colSpan: picked.colSpan })
    setPickerOpen(false)
  }

  return (
    <div className="flex flex-col gap-3">
      {/* The plate leads, as it does in the rack's own device modal. */}
      <div className="flex flex-col items-center gap-2 rounded border border-border bg-background p-3">
        <PortPositionEditor
          faceplateId={value.faceplateId}
          label={label}
          status={status}
          ports={value.ports}
          uHeight={value.uHeight}
          colSpan={value.colSpan}
          color={value.color ?? undefined}
          textColor={value.textColor ?? undefined}
          bayColor={value.bayColor ?? undefined}
          interactive={editable && positioning}
          selectedPortId={selectedPortId}
          onSelect={setSelectedPortId}
          onChange={(ports) => onChange({ ...value, ports })}
        />
        {!editable && (
          <p className="text-[11px] text-muted-foreground">
            {plate.label} · {value.uHeight}U · {value.ports.length} port
            {value.ports.length === 1 ? '' : 's'}
          </p>
        )}
      </div>
      {editable && (
        <>
          <div className="flex flex-col gap-1.5">
            <Label className={fieldLabel}>Faceplate</Label>
            <button
              type="button"
              aria-label="Faceplate"
              data-faceplate={value.faceplateId}
              onClick={() => setPickerOpen(true)}
              className="flex cursor-pointer flex-col items-start gap-0.5 rounded border border-border bg-secondary px-2 py-1.5 text-left hover:border-primary"
            >
              <span className="text-sm">{plate.label}</span>
              <span className="text-[11px] text-primary">Browse faceplates…</span>
            </button>
            <FaceplatePicker
              open={pickerOpen}
              value={value.faceplateId}
              onPick={pickFaceplate}
              onClose={() => setPickerOpen(false)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label className={fieldLabel}>Height (U)</Label>
              <input
                type="number"
                min={1}
                max={MAX_RACK_U}
                className={inputClass}
                aria-label="Height (U)"
                value={value.uHeight}
                onChange={(e) =>
                  onChange({
                    ...value,
                    // The browser does not enforce min/max on a typed value, and
                    // a 0U plate draws as nothing at all.
                    uHeight: Math.min(MAX_RACK_U, Math.max(1, Number(e.target.value) || 1)),
                  })
                }
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className={fieldLabel}>{`Width (/${RACK_COLUMNS})`}</Label>
              <select
                className={inputClass}
                aria-label="Width"
                value={value.colSpan}
                onChange={(e) => onChange({ ...value, colSpan: Number(e.target.value) })}
              >
                <option value={RACK_COLUMNS}>Full width</option>
                <option value={RACK_COLUMNS / 2}>Half width</option>
                <option value={RACK_COLUMNS / 3}>Third width</option>
                <option value={RACK_COLUMNS / 4}>Quarter width</option>
                <option value={RACK_COLUMNS / 6}>Sixth width</option>
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className={fieldLabel}>Colours</Label>
            <PlateColorFields
              faceplateId={value.faceplateId}
              value={{
                color: value.color,
                textColor: value.textColor ?? null,
                bayColor: value.bayColor ?? null,
              }}
              onChange={(patch) => onChange({ ...value, ...patch })}
            />
          </div>

          <PortListEditor
            ports={value.ports}
            onChange={(ports) => onChange({ ...value, ports })}
            positioning={positioning}
            onPositioningChange={setPositioning}
            selectedPortId={selectedPortId}
            onSelect={setSelectedPortId}
          />
        </>
      )}

    </div>
  )
}

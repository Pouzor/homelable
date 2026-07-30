/** Right rail: settings for the selected rack or the selected mounted device. */
import { faceplateGroups } from '../faceplates'
import { RACK_COLUMNS } from '@/types'
import { freeUnits } from '../layout'
import { useRackStore } from '../store'
import { CABLE_TYPE_LABELS } from '../rackDefaults'
import type { CableType, DeviceStatus, PortType, RackNumbering, RackWidthStandard } from '@/types'

const inputClass =
  'w-full rounded border border-[#21262d] bg-[#0d1117] px-2 py-1 text-sm text-[#c9d1d9] outline-none focus:border-[#00d4ff]'
const labelClass = 'mb-1 block text-[11px] uppercase tracking-wide text-[#6e7681]'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <span className={labelClass}>{label}</span>
      {children}
    </div>
  )
}

function RackSettings({ rackId }: { rackId: string }) {
  const rack = useRackStore((s) => s.racks.find((r) => r.id === rackId))
  const devices = useRackStore((s) => s.devices)
  const updateRack = useRackStore((s) => s.updateRack)
  const updateRackStyle = useRackStore((s) => s.updateRackStyle)
  const removeRack = useRackStore((s) => s.removeRack)

  if (!rack) return null
  const used = rack.uHeight - freeUnits(rack, devices)

  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold">Rack settings</h2>

      <Field label="Name">
        <input
          className={inputClass}
          value={rack.name}
          onChange={(e) => updateRack(rack.id, { name: e.target.value })}
        />
      </Field>
      <Field label="Location">
        <input
          className={inputClass}
          value={rack.location ?? ''}
          onChange={(e) => updateRack(rack.id, { location: e.target.value })}
        />
      </Field>
      <Field label={`Height — ${used}U used of ${rack.uHeight}U`}>
        <input
          type="number"
          min={1}
          max={48}
          className={inputClass}
          value={rack.uHeight}
          onChange={(e) => updateRack(rack.id, { uHeight: Number(e.target.value) || 1 })}
        />
      </Field>
      <Field label="Width standard">
        <select
          className={inputClass}
          value={rack.widthStandard}
          onChange={(e) =>
            updateRack(rack.id, { widthStandard: e.target.value as RackWidthStandard })
          }
        >
          <option value="19">19 inch</option>
          <option value="10">10 inch (mini)</option>
        </select>
      </Field>
      <Field label="U numbering">
        <select
          className={inputClass}
          value={rack.numbering}
          onChange={(e) => updateRack(rack.id, { numbering: e.target.value as RackNumbering })}
        >
          <option value="bottom-up">1 at the bottom</option>
          <option value="top-down">1 at the top</option>
        </select>
      </Field>

      <h3 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-[#6e7681]">
        Style
      </h3>
      {(['frame', 'rail', 'interior'] as const).map((key) => (
        <Field key={key} label={key}>
          <input
            type="color"
            className="h-8 w-full cursor-pointer rounded border border-[#21262d] bg-[#0d1117]"
            value={rack.style[key]}
            onChange={(e) => updateRackStyle(rack.id, { [key]: e.target.value })}
          />
        </Field>
      ))}
      <label className="mb-2 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={rack.style.showNumbers}
          onChange={(e) => updateRackStyle(rack.id, { showNumbers: e.target.checked })}
        />
        Show U numbers
      </label>
      <label className="mb-4 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={rack.style.enclosed}
          onChange={(e) => updateRackStyle(rack.id, { enclosed: e.target.checked })}
        />
        Enclosed cabinet
      </label>

      <button
        className="w-full rounded border border-[#f85149] px-2 py-1.5 text-sm text-[#f85149] hover:bg-[#f8514922]"
        onClick={() => removeRack(rack.id)}
      >
        Delete rack
      </button>
    </div>
  )
}

function DeviceSettings({ deviceId }: { deviceId: string }) {
  const device = useRackStore((s) => s.devices.find((d) => d.id === deviceId))
  const cables = useRackStore((s) => s.cables)
  const updateDevice = useRackStore((s) => s.updateDevice)
  const applyFaceplate = useRackStore((s) => s.applyFaceplate)
  const unmountDevice = useRackStore((s) => s.unmountDevice)
  const addPort = useRackStore((s) => s.addPort)
  const updatePort = useRackStore((s) => s.updatePort)
  const removePort = useRackStore((s) => s.removePort)

  if (!device) return null

  const cableOf = (portId: string) =>
    cables.find(
      (c) =>
        (c.from.deviceId === device.id && c.from.portId === portId) ||
        (c.to.deviceId === device.id && c.to.portId === portId),
    )

  return (
    <div>
      <h2 className="mb-1 text-sm font-semibold">{device.label}</h2>
      <p className="mb-3 text-[11px] text-[#6e7681]">
        {device.deviceId
          ? device.nodeId
            ? 'From the Device Inventory · on a logical canvas'
            : 'From the Device Inventory'
          : 'Rack-only accessory'}
      </p>

      <Field label="Label">
        <input
          className={inputClass}
          value={device.label}
          onChange={(e) => updateDevice(device.id, { label: e.target.value })}
        />
      </Field>

      <Field label="Faceplate">
        <select
          className={inputClass}
          value={device.faceplateId}
          onChange={(e) => applyFaceplate(device.id, e.target.value)}
        >
          {faceplateGroups().map(({ group, items }) => (
            <optgroup key={group} label={group}>
              {items.map((plate) => (
                <option key={plate.id} value={plate.id}>
                  {plate.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <Field label="U position">
          <input
            type="number"
            min={1}
            className={inputClass}
            value={device.uStart}
            onChange={(e) => updateDevice(device.id, { uStart: Number(e.target.value) || 1 })}
          />
        </Field>
        <Field label="Height (U)">
          <input
            type="number"
            min={1}
            className={inputClass}
            value={device.uHeight}
            onChange={(e) => updateDevice(device.id, { uHeight: Number(e.target.value) || 1 })}
          />
        </Field>
        <Field label="Column">
          <input
            type="number"
            min={0}
            max={RACK_COLUMNS - 1}
            className={inputClass}
            value={device.colStart}
            onChange={(e) => updateDevice(device.id, { colStart: Number(e.target.value) || 0 })}
          />
        </Field>
        <Field label={`Width (/${RACK_COLUMNS})`}>
          <select
            className={inputClass}
            value={device.colSpan}
            onChange={(e) => updateDevice(device.id, { colSpan: Number(e.target.value) })}
          >
            <option value={RACK_COLUMNS}>Full width</option>
            <option value={RACK_COLUMNS / 2}>Half width</option>
            <option value={RACK_COLUMNS / 3}>Third width</option>
            <option value={RACK_COLUMNS / 4}>Quarter width</option>
          </select>
        </Field>
      </div>

      <Field label="Status">
        <select
          className={inputClass}
          value={device.status}
          onChange={(e) => updateDevice(device.id, { status: e.target.value as DeviceStatus })}
        >
          <option value="online">Online</option>
          <option value="offline">Offline</option>
          <option value="unknown">Unknown</option>
        </select>
      </Field>

      <Field label="Colour override">
        <input
          type="color"
          className="h-8 w-full cursor-pointer rounded border border-[#21262d] bg-[#0d1117]"
          value={device.color ?? '#2b323c'}
          onChange={(e) => updateDevice(device.id, { color: e.target.value })}
        />
      </Field>

      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-[#6e7681]">
          Ports ({device.ports.length})
        </h3>
        <button
          className="rounded border border-[#21262d] px-2 py-0.5 text-xs hover:border-[#00d4ff]"
          onClick={() =>
            addPort(device.id, {
              label: `p${device.ports.length + 1}`,
              type: 'rj45',
              x: 0.5,
              y: 0.5,
            })
          }
        >
          + Add
        </button>
      </div>
      <ul className="max-h-56 space-y-1 overflow-y-auto">
        {device.ports.map((port) => {
          const cable = cableOf(port.id)
          return (
            <li key={port.id} className="flex items-center gap-1">
              <input
                className={`${inputClass} flex-1`}
                value={port.label}
                onChange={(e) => updatePort(device.id, port.id, { label: e.target.value })}
              />
              <select
                className={`${inputClass} w-24`}
                value={port.type}
                onChange={(e) =>
                  updatePort(device.id, port.id, { type: e.target.value as PortType })
                }
              >
                {(['rj45', 'sfp', 'sfp+'] as PortType[]).map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ background: cable ? cable.color : '#30363d' }}
                title={cable ? `Patched — ${CABLE_TYPE_LABELS[cable.type as CableType]}` : 'Free'}
              />
              <button
                className="px-1 text-xs text-[#6e7681] hover:text-[#f85149]"
                onClick={() => removePort(device.id, port.id)}
                title="Remove port"
              >
                ✕
              </button>
            </li>
          )
        })}
      </ul>

      <button
        className="mt-4 w-full rounded border border-[#f85149] px-2 py-1.5 text-sm text-[#f85149] hover:bg-[#f8514922]"
        onClick={() => unmountDevice(device.id)}
      >
        Unmount {device.deviceId ? '(stays in inventory)' : ''}
      </button>
    </div>
  )
}

export function RackInspector() {
  const selectedDeviceId = useRackStore((s) => s.selectedDeviceId)
  const selectedRackId = useRackStore((s) => s.selectedRackId)

  return (
    <aside className="w-72 shrink-0 overflow-y-auto border-l border-border bg-[#161b22] p-3 text-sm text-foreground">
      {selectedDeviceId ? (
        <DeviceSettings deviceId={selectedDeviceId} />
      ) : selectedRackId ? (
        <RackSettings rackId={selectedRackId} />
      ) : (
        <p className="text-[11px] text-[#6e7681]">
          Select a rack or a mounted device to edit it.
        </p>
      )}
    </aside>
  )
}

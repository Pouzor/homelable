/**
 * Add / edit a mounted device.
 *
 * The rack canvas has no right rail: everything about a mount is edited here,
 * the way `NodeModal` owns a network node. Opened from the sidebar (`+ Device`)
 * or by double-clicking a plate.
 *
 * Creating offers the two sources the product recognises: an entry that already
 * exists in the **Device Inventory**, or a brand new one created from this
 * canvas (which lands in the inventory too). Accessories — blanks, shelves,
 * cable managers — are rack-only and never touch the inventory.
 */
import { useEffect, useMemo, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { useRackStore } from '../store'
import { faceplateGroups, getFaceplate } from '../faceplates'
import { generateUUID } from '@/utils/uuid'
import { RACK_COLUMNS, type DeviceStatus, type Port, type PortType } from '@/types'

const DEFAULT_COLOR = '#2b323c'

type Source = 'inventory' | 'new' | 'accessory'

const inputClass =
  'w-full rounded border border-[#30363d] bg-[#21262d] px-2 py-1 text-sm text-foreground outline-none focus:border-[#00d4ff]'
const fieldLabel = 'text-xs text-muted-foreground'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className={fieldLabel}>{label}</Label>
      {children}
    </div>
  )
}

export function RackDeviceModal() {
  const editor = useRackStore((s) => s.deviceEditor)
  const close = useRackStore((s) => s.closeDeviceEditor)
  if (!editor) return null
  // Remount per target so the form always re-seeds from the device it edits.
  return <DeviceForm key={editor.deviceId ?? 'new'} deviceId={editor.deviceId} onClose={close} />
}

function DeviceForm({ deviceId, onClose }: { deviceId: string | null; onClose: () => void }) {
  const device = useRackStore((s) => s.devices.find((d) => d.id === deviceId))
  const racks = useRackStore((s) => s.racks)
  const inventory = useRackStore((s) => s.inventory)
  const mountFromInventory = useRackStore((s) => s.mountFromInventory)
  const mountAccessory = useRackStore((s) => s.mountAccessory)
  const createInventoryDevice = useRackStore((s) => s.createInventoryDevice)
  const applyFaceplate = useRackStore((s) => s.applyFaceplate)
  const updateDevice = useRackStore((s) => s.updateDevice)
  const unmountDevice = useRackStore((s) => s.unmountDevice)
  const setPorts = useRackStore((s) => s.setPorts)

  const isEdit = !!device
  const unracked = useMemo(() => inventory.filter((i) => !i.racked), [inventory])
  const groups = useMemo(() => faceplateGroups(), [])

  const [source, setSource] = useState<Source>(unracked.length > 0 ? 'inventory' : 'new')
  const [inventoryId, setInventoryId] = useState(unracked[0]?.id ?? '')
  const [newIp, setNewIp] = useState('')
  const [rackId, setRackId] = useState(device?.rackId ?? racks[0]?.id ?? '')
  const [label, setLabel] = useState(device?.label ?? '')
  const [faceplateId, setFaceplateId] = useState(
    device?.faceplateId ?? unracked[0]?.suggestedFaceplateId ?? 'server-1u',
  )
  const [uStart, setUStart] = useState(device?.uStart ?? 1)
  const [uHeight, setUHeight] = useState(device?.uHeight ?? getFaceplate(faceplateId).uHeight)
  const [colStart, setColStart] = useState(device?.colStart ?? 0)
  const [colSpan, setColSpan] = useState(device?.colSpan ?? getFaceplate(faceplateId).colSpan)
  const [status, setStatus] = useState<DeviceStatus>(device?.status ?? 'unknown')
  const [color, setColor] = useState<string | undefined>(device?.color)
  const [ports, setLocalPorts] = useState<Port[]>(
    device?.ports ?? getFaceplate(faceplateId).ports.map((p) => ({ ...p, id: generateUUID() })),
  )
  const [plateChanged, setPlateChanged] = useState(false)
  const [busy, setBusy] = useState(false)

  // The inventory lives in the Device Inventory, which the user can edit from
  // elsewhere (or a scan can grow) — pull a fresh list when adding.
  const refreshInventory = useRackStore((s) => s.refreshInventory)
  useEffect(() => {
    if (!isEdit) void refreshInventory()
  }, [isEdit, refreshInventory])

  /** Swapping the plate reseeds size and ports — the old ports belong to it. */
  function pickFaceplate(id: string) {
    const plate = getFaceplate(id)
    setFaceplateId(id)
    setUHeight(plate.uHeight)
    setColSpan(plate.colSpan)
    setColStart((c) => Math.min(c, RACK_COLUMNS - plate.colSpan))
    setLocalPorts(plate.ports.map((p) => ({ ...p, id: generateUUID() })))
    setPlateChanged(true)
  }

  function pickInventory(id: string) {
    setInventoryId(id)
    const item = inventory.find((i) => i.id === id)
    if (!item) return
    if (!label.trim()) setLabel(item.label)
    setStatus(item.status)
    pickFaceplate(item.suggestedFaceplateId)
  }

  const geometry = { uStart, uHeight, colStart, colSpan }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      const id = isEdit ? commitEdit() : await commitCreate()
      if (!id) return
      setPorts(id, ports)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  function commitEdit(): string | null {
    if (!device) return null
    if (plateChanged && faceplateId !== device.faceplateId) applyFaceplate(device.id, faceplateId)
    const name = label.trim() || device.label
    if (!updateDevice(device.id, { ...geometry, label: name, status, color })) {
      toast.error('No room in the rack for that size')
      return null
    }
    return device.id
  }

  async function commitCreate(): Promise<string | null> {
    if (!rackId) {
      toast.error('Add a rack first')
      return null
    }
    const name = label.trim()

    if (source === 'accessory') {
      const id = mountAccessory(faceplateId, rackId, { uStart, colStart })
      if (!id) return noRoom()
      updateDevice(id, { ...geometry, label: name || getFaceplate(faceplateId).label, color })
      return id
    }

    let entryId = inventoryId
    if (source === 'new') {
      if (!name) {
        toast.error('Name the device first')
        return null
      }
      const created = await createInventoryDevice({ label: name, ip: newIp.trim() || null })
      if (!created) {
        toast.error('Could not add the device to the inventory')
        return null
      }
      entryId = created.id
    }
    if (!entryId) {
      toast.error('Pick a device from the inventory')
      return null
    }

    const id = mountFromInventory(entryId, rackId, { ...geometry, faceplateId })
    if (!id) return noRoom()
    // The mount takes its label and status from the inventory entry; only patch
    // what the form actually overrides.
    updateDevice(id, { ...geometry, status, color, ...(name ? { label: name } : {}) })
    return id
  }

  function noRoom(): null {
    toast.error('No free slot in this rack')
    return null
  }

  function handleUnmount() {
    if (!device) return
    unmountDevice(device.id)
    onClose()
  }

  const showInventoryPicker = !isEdit && source === 'inventory'

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md border-[#30363d] bg-[#161b22] text-foreground max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold">
            {isEdit ? 'Edit Device' : 'Add Device'}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={(e) => void handleSubmit(e)} className="mt-2 flex flex-col gap-3">
          {!isEdit && (
            <Field label="Source">
              <div className="flex gap-1">
                {(
                  [
                    ['inventory', 'From inventory'],
                    ['new', 'New device'],
                    ['accessory', 'Accessory'],
                  ] as [Source, string][]
                ).map(([value, text]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setSource(value)}
                    className={`flex-1 cursor-pointer rounded border px-2 py-1 text-xs ${
                      source === value
                        ? 'border-[#00d4ff] text-[#00d4ff]'
                        : 'border-[#30363d] text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {text}
                  </button>
                ))}
              </div>
            </Field>
          )}

          {showInventoryPicker && (
            <Field label="Device Inventory entry">
              <select
                className={inputClass}
                aria-label="Device Inventory entry"
                value={inventoryId}
                onChange={(e) => pickInventory(e.target.value)}
              >
                <option value="">Select a device…</option>
                {unracked.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                    {item.ip ? ` · ${item.ip}` : ''}
                  </option>
                ))}
              </select>
              {unracked.length === 0 && (
                <p className="text-[11px] text-muted-foreground">
                  Everything in the inventory is already racked — create a new device instead.
                </p>
              )}
            </Field>
          )}

          {!isEdit && source === 'new' && (
            <Field label="IP (optional)">
              <input
                className={`${inputClass} font-mono`}
                aria-label="IP"
                value={newIp}
                onChange={(e) => setNewIp(e.target.value)}
                placeholder="192.168.1.10"
              />
            </Field>
          )}

          {!isEdit && racks.length > 1 && (
            <Field label="Rack">
              <select
                className={inputClass}
                aria-label="Rack"
                value={rackId}
                onChange={(e) => setRackId(e.target.value)}
              >
                {racks.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </Field>
          )}

          <Field label="Label">
            <input
              className={inputClass}
              aria-label="Label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={source === 'accessory' ? getFaceplate(faceplateId).label : 'Device name'}
            />
          </Field>

          <Field label="Faceplate">
            <select
              className={inputClass}
              aria-label="Faceplate"
              value={faceplateId}
              onChange={(e) => pickFaceplate(e.target.value)}
            >
              {groups.map(({ group, items }) => (
                <optgroup key={group} label={group}>
                  {items.map((plate) => (
                    <option key={plate.id} value={plate.id}>
                      {plate.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            {plateChanged && isEdit && (
              <p className="text-[11px] text-[#e3b341]">
                Changing the plate replaces its ports and drops their patches.
              </p>
            )}
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="U position">
              <input
                type="number"
                min={1}
                className={inputClass}
                aria-label="U position"
                value={uStart}
                onChange={(e) => setUStart(Number(e.target.value) || 1)}
              />
            </Field>
            <Field label="Height (U)">
              <input
                type="number"
                min={1}
                max={12}
                className={inputClass}
                aria-label="Height (U)"
                value={uHeight}
                onChange={(e) => setUHeight(Number(e.target.value) || 1)}
              />
            </Field>
            <Field label="Column">
              <input
                type="number"
                min={0}
                max={RACK_COLUMNS - 1}
                className={inputClass}
                aria-label="Column"
                value={colStart}
                onChange={(e) => setColStart(Number(e.target.value) || 0)}
              />
            </Field>
            <Field label={`Width (/${RACK_COLUMNS})`}>
              <select
                className={inputClass}
                aria-label="Width"
                value={colSpan}
                onChange={(e) => setColSpan(Number(e.target.value))}
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
              aria-label="Status"
              value={status}
              onChange={(e) => setStatus(e.target.value as DeviceStatus)}
            >
              <option value="online">Online</option>
              <option value="offline">Offline</option>
              <option value="unknown">Unknown</option>
            </select>
          </Field>

          <Field label="Colour override">
            <div className="flex items-center gap-2">
              <input
                type="color"
                aria-label="Colour override"
                className="h-8 flex-1 cursor-pointer rounded border border-[#30363d] bg-[#21262d]"
                value={color ?? DEFAULT_COLOR}
                onChange={(e) => setColor(e.target.value)}
              />
              <button
                type="button"
                onClick={() => setColor(undefined)}
                className="rounded border border-[#30363d] px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground cursor-pointer"
              >
                Reset
              </button>
            </div>
          </Field>

          <div className="flex items-center justify-between">
            <Label className={fieldLabel}>Ports ({ports.length})</Label>
            <button
              type="button"
              aria-label="Add port"
              className="cursor-pointer rounded border border-[#30363d] px-2 py-0.5 text-xs hover:border-[#00d4ff]"
              onClick={() =>
                setLocalPorts((p) => [
                  ...p,
                  { id: generateUUID(), label: `p${p.length + 1}`, type: 'rj45', x: 0.5, y: 0.5 },
                ])
              }
            >
              <Plus size={12} className="inline" /> Add
            </button>
          </div>
          <ul className="max-h-40 space-y-1 overflow-y-auto">
            {ports.map((port) => (
              <li key={port.id} className="flex items-center gap-1">
                <input
                  className={`${inputClass} flex-1`}
                  aria-label={`Port ${port.label} label`}
                  value={port.label}
                  onChange={(e) =>
                    setLocalPorts((list) =>
                      list.map((p) => (p.id === port.id ? { ...p, label: e.target.value } : p)),
                    )
                  }
                />
                <select
                  className={`${inputClass} w-24`}
                  aria-label={`Port ${port.label} type`}
                  value={port.type}
                  onChange={(e) =>
                    setLocalPorts((list) =>
                      list.map((p) =>
                        p.id === port.id ? { ...p, type: e.target.value as PortType } : p,
                      ),
                    )
                  }
                >
                  {(['rj45', 'sfp', 'sfp+'] as PortType[]).map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  aria-label={`Remove port ${port.label}`}
                  className="cursor-pointer px-1 text-xs text-muted-foreground hover:text-[#f85149]"
                  onClick={() => setLocalPorts((list) => list.filter((p) => p.id !== port.id))}
                >
                  <X size={12} />
                </button>
              </li>
            ))}
            {ports.length === 0 && (
              <li className="text-[11px] text-muted-foreground">No port on this plate.</li>
            )}
          </ul>

          <div className="mt-1 flex items-center gap-2">
            {isEdit && (
              <Button
                type="button"
                variant="ghost"
                onClick={handleUnmount}
                className="cursor-pointer text-[#f85149] hover:bg-[#f8514922] hover:text-[#f85149]"
              >
                Unmount{device?.deviceId ? ' (stays in inventory)' : ''}
              </Button>
            )}
            <div className="ml-auto flex gap-2">
              <Button type="button" variant="ghost" onClick={onClose} className="cursor-pointer">
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={busy}
                className="cursor-pointer bg-[#00d4ff] text-[#0d1117] hover:bg-[#00b8e0]"
              >
                {isEdit ? 'Save' : 'Add'}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

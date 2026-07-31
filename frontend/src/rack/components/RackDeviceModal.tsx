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
import { PendingDevicesModal } from '@/components/modals/PendingDevicesModal'
import type { PendingDevice } from '@/components/modals/PendingDeviceModal'
import { useRackStore } from '../store'
import { FaceplatePicker } from './FaceplatePicker'
import { Faceplate } from './Faceplate'
import { deviceTypeForFaceplate, getFaceplate } from '../faceplates'
import { findSlot } from '../layout'
import { canFollowNode, resolveDeviceStatus } from '../deviceStatus'
import { generateUUID } from '@/utils/uuid'
import {
  RACK_COLUMNS,
  type InventoryDevice,
  type MountStatus,
  type Port,
  type PortType,
} from '@/types'

const DEFAULT_COLOR = '#2b323c'
const STANDALONE = import.meta.env.VITE_STANDALONE === 'true'

type Source = 'inventory' | 'new' | 'accessory'

const inputBase =
  'rounded border border-[#30363d] bg-[#21262d] px-2 py-1 text-sm text-foreground outline-none focus:border-[#00d4ff]'
const inputClass = `w-full ${inputBase}`
const fieldLabel = 'text-xs text-muted-foreground'

/**
 * One line for the inventory picker.
 *
 * Entries with no hostname are already labelled with their IP by the backend, so
 * appending it again printed "192.168.1.63 · 192.168.1.63". Show the IP only
 * when it adds something, and the type as the tiebreaker between look-alikes.
 */
function inventoryOption(item: InventoryDevice): string {
  const parts = [item.label]
  if (item.ip && item.ip !== item.label) parts.push(item.ip)
  if (item.type) parts.push(item.type)
  return parts.join(' · ')
}

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
  const devices = useRackStore((s) => s.devices)
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

  const [source, setSource] = useState<Source>(unracked.length > 0 ? 'inventory' : 'new')
  // No preselection: the entry comes from the Device Inventory modal, which the
  // user opens and picks from explicitly.
  const [inventoryId, setInventoryId] = useState('')
  const [newIp, setNewIp] = useState('')
  const [rackId, setRackId] = useState(device?.rackId ?? racks[0]?.id ?? '')
  const [label, setLabel] = useState(device?.label ?? '')
  const [faceplateId, setFaceplateId] = useState(device?.faceplateId ?? 'server-1u')
  const [uStart, setUStart] = useState(device?.uStart ?? 1)
  const [uHeight, setUHeight] = useState(device?.uHeight ?? getFaceplate(faceplateId).uHeight)
  const [colStart, setColStart] = useState(device?.colStart ?? 0)
  const [colSpan, setColSpan] = useState(device?.colSpan ?? getFaceplate(faceplateId).colSpan)
  const [status, setStatus] = useState<MountStatus>(device?.status ?? 'unknown')
  const [color, setColor] = useState<string | undefined>(device?.color)
  const [ports, setLocalPorts] = useState<Port[]>(
    device?.ports ?? getFaceplate(faceplateId).ports.map((p) => ({ ...p, id: generateUUID() })),
  )
  const [plateChanged, setPlateChanged] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [inventoryPickerOpen, setInventoryPickerOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  // The inventory lives in the Device Inventory, which the user can edit from
  // elsewhere (or a scan can grow) — pull a fresh list when adding.
  const refreshInventory = useRackStore((s) => s.refreshInventory)
  useEffect(() => {
    if (!isEdit) void refreshInventory()
  }, [isEdit, refreshInventory])

  // That refetch can drop the preselected entry (racked from elsewhere, deleted),
  // leaving the select blank while the state still held the dead id.
  useEffect(() => {
    if (isEdit) return
    setInventoryId((current) =>
      current && !unracked.some((i) => i.id === current) ? '' : current,
    )
  }, [isEdit, unracked])

  /** Swapping the plate reseeds size and ports — the old ports belong to it. */
  function pickFaceplate(id: string) {
    const plate = getFaceplate(id)
    setFaceplateId(id)
    setUHeight(plate.uHeight)
    setColSpan(plate.colSpan)
    setColStart((c) => Math.min(c, RACK_COLUMNS - plate.colSpan))
    // Coming back to the plate the device already wears is not a change: keep
    // its own ports, ids included. Reseeding them would hand `setPorts` a list
    // of unknown ids on save and take every cable on the device down with it.
    const reverted = device && id === device.faceplateId
    setLocalPorts(
      reverted ? device.ports : plate.ports.map((p) => ({ ...p, id: generateUUID() })),
    )
    setPlateChanged(!reverted)
  }

  /** Accessories and devices draw from disjoint halves of the catalog. */
  function pickSource(next: Source) {
    setSource(next)
    const wantAccessory = next === 'accessory'
    if ((getFaceplate(faceplateId).kind === 'accessory') !== wantAccessory) {
      pickFaceplate(wantAccessory ? 'blank-1u' : 'server-1u')
    }
  }

  function applyInventoryItem(item: InventoryDevice) {
    setInventoryId(item.id)
    if (!label.trim()) setLabel(item.label)
    // Seed the entry's current colour, not `auto`: following the node's check
    // is the user's call, made in the Status select.
    setStatus(item.status)
    pickFaceplate(item.suggestedFaceplateId)
  }

  /**
   * A device picked in the Device Inventory modal.
   *
   * That modal reads `pending_devices` directly, while the rack keeps its own
   * rackable-and-flagged copy — so a row can be visible there and absent here
   * (added since this form opened, or a kind no rack can hold). Refetch once
   * before refusing, and never mount a device twice in the same design.
   */
  async function handlePickFromInventory(picked: PendingDevice) {
    let entry = inventory.find((i) => i.id === picked.id)
    if (!entry) {
      await refreshInventory()
      entry = useRackStore.getState().inventory.find((i) => i.id === picked.id)
    }
    if (!entry) {
      toast.error('That device cannot be mounted in a rack')
      return
    }
    if (entry.racked) {
      toast.error(`${entry.label} is already mounted in this design`)
      return
    }
    applyInventoryItem(entry)
    setInventoryPickerOpen(false)
  }

  /**
   * The Device Inventory row behind this mount: the entry being picked while
   * adding, the one the mount was created from while editing.
   */
  const selectedEntry = inventory.find((i) => i.id === inventoryId)
  const mountEntry = isEdit ? inventory.find((i) => i.id === device?.deviceId) : selectedEntry

  // "Check device" needs a canvas node to read a check from — one the mount
  // already carries, or one the picked entry resolves to.
  const canCheck = (isEdit && !!device?.nodeId) || canFollowNode(mountEntry)

  // Losing that link (another entry picked, node deleted) must not leave the
  // form on a status nothing can resolve.
  useEffect(() => {
    if (!canCheck) setStatus((s) => (s === 'auto' ? 'unknown' : s))
  }, [canCheck])

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
    // A plate the rack has no room for changes nothing — and the caller would
    // still write the new plate's ports onto the old faceplate, silently.
    if (plateChanged && faceplateId !== device.faceplateId) {
      if (!applyFaceplate(device.id, faceplateId)) {
        toast.error('No room in the rack for that faceplate')
        return null
      }
    }
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
      // Hand the mount the whole geometry: it snaps to the nearest slot that
      // fits, and patching it afterwards would drag the plate back off it.
      const id = mountAccessory(faceplateId, rackId, geometry)
      if (!id) return noRoom()
      updateDevice(id, { label: name || getFaceplate(faceplateId).label, color })
      return id
    }

    let entryId = inventoryId
    if (source === 'new') {
      if (!name) {
        toast.error('Name the device first')
        return null
      }
      // `createInventoryDevice` POSTs straight to the Device Inventory, so a
      // mount that fails afterwards would leave a row behind — and a second one
      // on every retry. Check the rack has a slot before creating anything.
      const rack = racks.find((r) => r.id === rackId)
      if (!rack || !findSlot(rack, devices, geometry)) return noRoom()
      // Nothing discovered this device, so the plate is what says what it is —
      // otherwise the inventory row shows up with no type, no icon, no filter.
      const created = await createInventoryDevice({
        label: name,
        type: deviceTypeForFaceplate(faceplateId),
        ip: newIp.trim() || null,
      })
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
    // The mount takes its label and status from the inventory entry, and its
    // slot from `findSlot` — only patch what the form actually overrides.
    updateDevice(id, { status, color, ...(name ? { label: name } : {}) })
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
  // The plate preview draws a colour, never the word `auto`.
  const previewStatus = resolveDeviceStatus(
    { status, deviceId: mountEntry?.id ?? null },
    inventory,
  )

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      {/* Same footprint as NodeModal — the form is two columns wide so a mount
          fits on screen without scrolling. */}
      <DialogContent className="border-[#30363d] bg-[#161b22] text-foreground max-w-[calc(100%-2rem)] sm:max-w-3xl max-h-[90vh] overflow-y-auto">
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
                    onClick={() => pickSource(value)}
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

          {/* Left column: what the device is and where it sits. Right column:
              its ports, which is the list that used to push everything else
              below the fold. */}
          <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
            <div className="flex flex-col gap-3">
            {showInventoryPicker && STANDALONE && (
              /* No backend, so no Device Inventory modal to open (it reads
                 `pending_devices` over REST) — standalone keeps the flat list. */
              <Field label="Device Inventory entry">
                <select
                  className={inputClass}
                  aria-label="Device Inventory entry"
                  value={inventoryId}
                  onChange={(e) => {
                    const item = inventory.find((i) => i.id === e.target.value)
                    if (item) applyInventoryItem(item)
                    else setInventoryId('')
                  }}
                >
                  <option value="">Select a device…</option>
                  {unracked.map((item) => (
                    <option key={item.id} value={item.id}>
                      {inventoryOption(item)}
                    </option>
                  ))}
                </select>
              </Field>
            )}

            {showInventoryPicker && !STANDALONE && (
              <Field label="Device Inventory entry">
                {/* Opens the real Device Inventory rather than a flat <select>:
                    the user gets its search, source/type filters and the tech
                    detail on each card to tell look-alike hosts apart. */}
                <button
                  type="button"
                  aria-label="Device Inventory entry"
                  data-device-id={inventoryId}
                  onClick={() => setInventoryPickerOpen(true)}
                  className="flex cursor-pointer flex-col items-start gap-0.5 rounded border border-[#30363d] bg-[#21262d] px-2 py-1.5 text-left hover:border-[#00d4ff]"
                >
                  <span className="text-sm">
                    {selectedEntry ? inventoryOption(selectedEntry) : 'No device picked yet'}
                  </span>
                  <span className="text-[11px] text-[#00d4ff]">
                    {selectedEntry ? 'Change device…' : 'Browse the Device Inventory…'}
                  </span>
                </button>
                {unracked.length === 0 && (
                  <p className="text-[11px] text-muted-foreground">
                    Everything in the inventory is already racked — create a new device instead.
                  </p>
                )}
                {/* Rendered inside this DialogContent on purpose: an open Base UI
                    dialog marks outside content inert, so a sibling overlay would
                    be unclickable. */}
                <PendingDevicesModal
                  open={inventoryPickerOpen}
                  onClose={() => setInventoryPickerOpen(false)}
                  onPick={(d) => void handlePickFromInventory(d)}
                  initialRackableOnly
                />
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
              {/* The catalog is visual — the button previews the current plate and
                  opens the picker rather than hiding drawings behind a name. */}
              <button
                type="button"
                aria-label="Faceplate"
                data-faceplate={faceplateId}
                onClick={() => setPickerOpen(true)}
                className="flex cursor-pointer items-center gap-3 rounded border border-[#30363d] bg-[#21262d] p-2 text-left hover:border-[#00d4ff]"
              >
                <Faceplate
                  faceplateId={faceplateId}
                  label={label || getFaceplate(faceplateId).label}
                  status={previewStatus}
                  ports={ports}
                  width={(160 * colSpan) / RACK_COLUMNS}
                  height={Math.min(uHeight, 4) * 18}
                  colorOverride={color}
                  revealed
                />
                <span className="flex flex-col">
                  <span className="text-xs">{getFaceplate(faceplateId).label}</span>
                  <span className="text-[11px] text-[#00d4ff]">Browse faceplates…</span>
                </span>
              </button>
              <FaceplatePicker
                open={pickerOpen}
                value={faceplateId}
                kind={!isEdit && source === 'accessory' ? 'accessory' : undefined}
                onPick={pickFaceplate}
                onClose={() => setPickerOpen(false)}
              />
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
                  <option value={RACK_COLUMNS / 6}>Sixth width</option>
                </select>
              </Field>
            </div>

            <Field label="Status">
              <select
                className={inputClass}
                aria-label="Status"
                value={status}
                onChange={(e) => setStatus(e.target.value as MountStatus)}
              >
                {/* Only offered when there is a node to read: the rack runs no
                    check of its own. */}
                {canCheck && <option value="auto">Check device (live)</option>}
                <option value="online">Online</option>
                <option value="offline">Offline</option>
                <option value="unknown">Unknown</option>
              </select>
              {status === 'auto' && (
                <p className="text-[11px] text-muted-foreground">
                  Follows the status check configured on the matching canvas node.
                </p>
              )}
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
            </div>

            <div className="flex flex-col gap-1.5">
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
              <ul className="max-h-[26rem] space-y-1 overflow-y-auto">
                {ports.map((port) => (
                  <li key={port.id} className="flex items-center gap-1">
                    <input
                      // `inputClass` is w-full: without min-w-0 the flex row lets the
                      // type select win the space and the name field collapses to a box.
                      className={`${inputBase} min-w-0 flex-1`}
                      aria-label={`Port ${port.label} label`}
                      placeholder="Port name"
                      value={port.label}
                      onChange={(e) =>
                        setLocalPorts((list) =>
                          list.map((p) => (p.id === port.id ? { ...p, label: e.target.value } : p)),
                        )
                      }
                    />
                    <select
                      className={`${inputBase} w-24 shrink-0`}
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
            </div>
          </div>

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

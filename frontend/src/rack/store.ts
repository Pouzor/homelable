/**
 * Rack canvas prototype store.
 *
 * In-memory only — the prototype deliberately has no API and no persistence.
 * Removing a device from a rack never removes it from the inventory, mirroring
 * how the network canvas already treats inventory nodes.
 */
import { create } from 'zustand'
import { generateUUID } from '@/utils/uuid'
import { getFaceplate } from './faceplates'
import { canPlace, findSlot, type Placement } from './layout'
import { RACK_COLUMNS, type Cable, type CableType, type CableVisibility, type InventoryDevice, type Port, type Rack, type RackDevice, type RackStyle } from './types'
import { demoCables, demoDevices, demoInventory, demoRacks, networkEdgeHints } from './demoData'
import { CABLE_COLORS, DEFAULT_RACK_STYLE, PORT_CABLE_TYPE } from './rackDefaults'

export { CABLE_COLORS, DEFAULT_RACK_STYLE }

/** Draft cable being drawn, port by port. */
interface CableDraft {
  deviceId: string
  portId: string
}

interface RackState {
  racks: Rack[]
  devices: RackDevice[]
  cables: Cable[]
  inventory: InventoryDevice[]

  // UI
  selectedDeviceId: string | null
  selectedRackId: string | null
  hoveredDeviceId: string | null
  cableVisibility: CableVisibility
  /** Port-picking mode: click a port, then another, to create a cable. */
  cableMode: boolean
  cableDraft: CableDraft | null
  cableTypeFilter: CableType | 'all'

  // Racks
  addRack: (partial?: Partial<Rack>) => string
  updateRack: (id: string, patch: Partial<Omit<Rack, 'id'>>) => void
  updateRackStyle: (id: string, patch: Partial<RackStyle>) => void
  moveRack: (id: string, position: { x: number; y: number }) => void
  /** Removes the rack and every device mounted in it (inventory untouched). */
  removeRack: (id: string) => void

  // Devices
  /** Mount an inventory entry. Returns the new device id, or null if no room. */
  mountFromInventory: (inventoryId: string, rackId: string, desired: Partial<Placement>) => string | null
  /** Mount a rack-only accessory (blank panel, shelf…). */
  mountAccessory: (faceplateId: string, rackId: string, desired: Partial<Placement>) => string | null
  moveDevice: (deviceId: string, rackId: string, desired: Placement) => boolean
  updateDevice: (id: string, patch: Partial<Omit<RackDevice, 'id' | 'ports'>>) => void
  /** Unmounts from the rack. The inventory entry survives. */
  unmountDevice: (id: string) => void
  applyFaceplate: (deviceId: string, faceplateId: string) => void

  // Ports
  addPort: (deviceId: string, port: Omit<Port, 'id'>) => void
  updatePort: (deviceId: string, portId: string, patch: Partial<Omit<Port, 'id'>>) => void
  removePort: (deviceId: string, portId: string) => void

  // Cables
  addCable: (
    from: CableDraft,
    to: CableDraft,
    options?: { type?: CableType; color?: string; label?: string },
  ) => string | null
  updateCable: (id: string, patch: Partial<Omit<Cable, 'id'>>) => void
  removeCable: (id: string) => void
  /** One-shot seed from the logical canvas — offered at creation time only. */
  importCablesFromNetwork: () => number
  networkImportDone: boolean

  // UI actions
  selectDevice: (id: string | null) => void
  selectRack: (id: string | null) => void
  hoverDevice: (id: string | null) => void
  setCableVisibility: (v: CableVisibility) => void
  setCableTypeFilter: (t: CableType | 'all') => void
  toggleCableMode: () => void
  pickPort: (deviceId: string, portId: string) => void
  cancelCableDraft: () => void
  reset: () => void
}

function withIds(ports: Omit<Port, 'id'>[]): Port[] {
  return ports.map((p) => ({ ...p, id: generateUUID() }))
}

function initialState() {
  return {
    racks: demoRacks(),
    devices: demoDevices(),
    cables: demoCables(),
    inventory: demoInventory(),
    selectedDeviceId: null,
    selectedRackId: null,
    hoveredDeviceId: null,
    cableVisibility: 'hover' as CableVisibility,
    cableMode: false,
    cableDraft: null,
    cableTypeFilter: 'all' as const,
    networkImportDone: false,
  }
}

export const useRackStore = create<RackState>((set, get) => ({
  ...initialState(),

  // --- Racks --------------------------------------------------------------
  addRack: (partial) => {
    const id = partial?.id ?? generateUUID()
    const count = get().racks.length
    const rack: Rack = {
      id,
      name: `Rack ${count + 1}`,
      uHeight: 24,
      widthStandard: '19',
      numbering: 'bottom-up',
      style: { ...DEFAULT_RACK_STYLE },
      position: { x: 80 + count * 620, y: 60 },
      ...partial,
    }
    set((s) => ({ racks: [...s.racks, rack], selectedRackId: id }))
    return id
  },

  updateRack: (id, patch) =>
    set((s) => ({ racks: s.racks.map((r) => (r.id === id ? { ...r, ...patch } : r)) })),

  updateRackStyle: (id, patch) =>
    set((s) => ({
      racks: s.racks.map((r) => (r.id === id ? { ...r, style: { ...r.style, ...patch } } : r)),
    })),

  moveRack: (id, position) =>
    set((s) => ({ racks: s.racks.map((r) => (r.id === id ? { ...r, position } : r)) })),

  removeRack: (id) =>
    set((s) => {
      const doomed = new Set(s.devices.filter((d) => d.rackId === id).map((d) => d.id))
      return {
        racks: s.racks.filter((r) => r.id !== id),
        devices: s.devices.filter((d) => d.rackId !== id),
        cables: s.cables.filter(
          (c) => !doomed.has(c.from.deviceId) && !doomed.has(c.to.deviceId),
        ),
        selectedRackId: s.selectedRackId === id ? null : s.selectedRackId,
      }
    }),

  // --- Devices ------------------------------------------------------------
  mountFromInventory: (inventoryId, rackId, desired) => {
    const { racks, devices, inventory } = get()
    const rack = racks.find((r) => r.id === rackId)
    const item = inventory.find((i) => i.id === inventoryId)
    if (!rack || !item) return null

    const plate = getFaceplate(item.suggestedFaceplateId)
    const slot = findSlot(rack, devices, {
      uStart: desired.uStart ?? 1,
      uHeight: desired.uHeight ?? plate.uHeight,
      colStart: desired.colStart ?? 0,
      colSpan: desired.colSpan ?? plate.colSpan,
    })
    if (!slot) return null

    const device: RackDevice = {
      id: generateUUID(),
      rackId,
      nodeId: item.id,
      label: item.label,
      status: item.status,
      faceplateId: plate.id,
      ports: withIds(plate.ports),
      ...slot,
    }
    set((s) => ({ devices: [...s.devices, device], selectedDeviceId: device.id }))
    return device.id
  },

  mountAccessory: (faceplateId, rackId, desired) => {
    const { racks, devices } = get()
    const rack = racks.find((r) => r.id === rackId)
    if (!rack) return null

    const plate = getFaceplate(faceplateId)
    const slot = findSlot(rack, devices, {
      uStart: desired.uStart ?? 1,
      uHeight: desired.uHeight ?? plate.uHeight,
      colStart: desired.colStart ?? 0,
      colSpan: desired.colSpan ?? plate.colSpan,
    })
    if (!slot) return null

    const device: RackDevice = {
      id: generateUUID(),
      rackId,
      nodeId: null,
      label: plate.label,
      status: 'unknown',
      faceplateId: plate.id,
      ports: withIds(plate.ports),
      ...slot,
    }
    set((s) => ({ devices: [...s.devices, device], selectedDeviceId: device.id }))
    return device.id
  },

  moveDevice: (deviceId, rackId, desired) => {
    const { racks, devices } = get()
    const rack = racks.find((r) => r.id === rackId)
    if (!rack) return false
    if (!canPlace(rack, devices, desired, deviceId)) return false
    set((s) => ({
      devices: s.devices.map((d) => (d.id === deviceId ? { ...d, rackId, ...desired } : d)),
    }))
    return true
  },

  updateDevice: (id, patch) =>
    set((s) => {
      const device = s.devices.find((d) => d.id === id)
      const rack = device && s.racks.find((r) => r.id === (patch.rackId ?? device.rackId))
      if (!device || !rack) return s
      const next = { ...device, ...patch }
      const geometryChanged =
        next.uStart !== device.uStart ||
        next.uHeight !== device.uHeight ||
        next.colStart !== device.colStart ||
        next.colSpan !== device.colSpan
      if (geometryChanged && !canPlace(rack, s.devices, next, id)) return s
      return { devices: s.devices.map((d) => (d.id === id ? next : d)) }
    }),

  unmountDevice: (id) =>
    set((s) => ({
      devices: s.devices.filter((d) => d.id !== id),
      cables: s.cables.filter((c) => c.from.deviceId !== id && c.to.deviceId !== id),
      selectedDeviceId: s.selectedDeviceId === id ? null : s.selectedDeviceId,
    })),

  applyFaceplate: (deviceId, faceplateId) =>
    set((s) => {
      const device = s.devices.find((d) => d.id === deviceId)
      const rack = device && s.racks.find((r) => r.id === device.rackId)
      if (!device || !rack) return s
      const plate = getFaceplate(faceplateId)
      const resized = {
        ...device,
        faceplateId,
        uHeight: plate.uHeight,
        colSpan: plate.colSpan,
        colStart: Math.min(device.colStart, RACK_COLUMNS - plate.colSpan),
        ports: withIds(plate.ports),
      }
      if (!canPlace(rack, s.devices, resized, deviceId)) {
        // Keep the plate but leave the geometry alone when it no longer fits.
        return {
          devices: s.devices.map((d) =>
            d.id === deviceId ? { ...d, faceplateId, ports: withIds(plate.ports) } : d,
          ),
        }
      }
      return {
        devices: s.devices.map((d) => (d.id === deviceId ? resized : d)),
        cables: s.cables.filter(
          (c) => c.from.deviceId !== deviceId && c.to.deviceId !== deviceId,
        ),
      }
    }),

  // --- Ports --------------------------------------------------------------
  addPort: (deviceId, port) =>
    set((s) => ({
      devices: s.devices.map((d) =>
        d.id === deviceId ? { ...d, ports: [...d.ports, { ...port, id: generateUUID() }] } : d,
      ),
    })),

  updatePort: (deviceId, portId, patch) =>
    set((s) => ({
      devices: s.devices.map((d) =>
        d.id === deviceId
          ? { ...d, ports: d.ports.map((p) => (p.id === portId ? { ...p, ...patch } : p)) }
          : d,
      ),
    })),

  removePort: (deviceId, portId) =>
    set((s) => ({
      devices: s.devices.map((d) =>
        d.id === deviceId ? { ...d, ports: d.ports.filter((p) => p.id !== portId) } : d,
      ),
      cables: s.cables.filter(
        (c) =>
          !(c.from.deviceId === deviceId && c.from.portId === portId) &&
          !(c.to.deviceId === deviceId && c.to.portId === portId),
      ),
    })),

  // --- Cables -------------------------------------------------------------
  addCable: (from, to, options) => {
    const { devices, cables } = get()
    if (from.deviceId === to.deviceId && from.portId === to.portId) return null

    const hasPort = (ref: CableDraft) =>
      devices.some((d) => d.id === ref.deviceId && d.ports.some((p) => p.id === ref.portId))
    if (!hasPort(from) || !hasPort(to)) return null

    // A physical port takes one cable.
    const taken = (ref: CableDraft) =>
      cables.some(
        (c) =>
          (c.from.deviceId === ref.deviceId && c.from.portId === ref.portId) ||
          (c.to.deviceId === ref.deviceId && c.to.portId === ref.portId),
      )
    if (taken(from) || taken(to)) return null

    // Fibre vs copper follows the port the patch starts from.
    const fromPort = devices
      .find((d) => d.id === from.deviceId)!
      .ports.find((p) => p.id === from.portId)!
    const type = options?.type ?? PORT_CABLE_TYPE[fromPort.type]
    const cable: Cable = {
      id: generateUUID(),
      type,
      color: options?.color ?? CABLE_COLORS[type],
      label: options?.label,
      from,
      to,
    }
    set((s) => ({ cables: [...s.cables, cable] }))
    return cable.id
  },

  updateCable: (id, patch) =>
    set((s) => ({ cables: s.cables.map((c) => (c.id === id ? { ...c, ...patch } : c)) })),

  removeCable: (id) => set((s) => ({ cables: s.cables.filter((c) => c.id !== id) })),

  importCablesFromNetwork: () => {
    const { devices, networkImportDone } = get()
    if (networkImportDone) return 0

    let created = 0
    for (const hint of networkEdgeHints()) {
      const a = devices.find((d) => d.nodeId === hint.from)
      const b = devices.find((d) => d.nodeId === hint.to)
      if (!a || !b) continue
      const usedPorts = new Set(
        get().cables.flatMap((c) => [
          `${c.from.deviceId}:${c.from.portId}`,
          `${c.to.deviceId}:${c.to.portId}`,
        ]),
      )
      const freePort = (device: typeof a) =>
        device.ports.find((p) => !usedPorts.has(`${device.id}:${p.id}`))
      const pa = freePort(a)
      const pb = freePort(b)
      if (!pa || !pb) continue
      const id = get().addCable(
        { deviceId: a.id, portId: pa.id },
        { deviceId: b.id, portId: pb.id },
        { type: hint.type, label: hint.label },
      )
      if (id) created++
    }
    set({ networkImportDone: true })
    return created
  },

  // --- UI -----------------------------------------------------------------
  selectDevice: (id) => set({ selectedDeviceId: id, selectedRackId: null }),
  selectRack: (id) => set({ selectedRackId: id, selectedDeviceId: null }),
  hoverDevice: (id) => set({ hoveredDeviceId: id }),
  setCableVisibility: (v) => set({ cableVisibility: v }),
  setCableTypeFilter: (t) => set({ cableTypeFilter: t }),

  toggleCableMode: () =>
    set((s) => ({
      cableMode: !s.cableMode,
      cableDraft: null,
      cableVisibility: !s.cableMode ? 'always' : s.cableVisibility,
    })),

  pickPort: (deviceId, portId) => {
    const { cableDraft } = get()
    if (!cableDraft) {
      set({ cableDraft: { deviceId, portId } })
      return
    }
    get().addCable(cableDraft, { deviceId, portId })
    set({ cableDraft: null })
  },

  cancelCableDraft: () => set({ cableDraft: null }),

  reset: () => set(initialState()),
}))

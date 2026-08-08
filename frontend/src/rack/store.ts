/**
 * Rack canvas store.
 *
 * Holds one rack design at a time: its racks, mounted gear, patches and the
 * Device Inventory entries offered to the tray. Persistence is explicit — the
 * user saves, like the logical canvas — and every mutating action marks the
 * canvas dirty.
 *
 * Unmounting a device never removes it from the inventory, mirroring how the
 * network canvas already treats inventory nodes.
 */
import { create } from 'zustand'
import { racksApi, scanApi } from '@/api/client'
import { generateUUID } from '@/utils/uuid'
import * as standaloneStorage from '@/utils/standaloneStorage'
import {
  buildSavePayload,
  toCable,
  toInventoryDevice,
  toRack,
  toRackDevice,
} from '@/utils/rackSerializer'
import { getFaceplate, suggestFaceplate } from './faceplates'
import { canPlace, findSlot, type Placement } from './layout'
import {
  RACK_COLUMNS,
  type Cable,
  type CableType,
  type CableVisibility,
  type InventoryDevice,
  type Port,
  type Rack,
  type RackDevice,
  type RackStyle,
} from '@/types'
import { demoCables, demoDevices, demoInventory, demoRacks } from './demoData'
import { CABLE_COLORS, DEFAULT_RACK_STYLE, PORT_CABLE_TYPE } from './rackDefaults'

export { CABLE_COLORS, DEFAULT_RACK_STYLE }

const STANDALONE = import.meta.env.VITE_STANDALONE === 'true'

const DEFAULT_VIEWPORT = { x: 0, y: 0, zoom: 1 }

/** Draft cable being drawn, port by port. */
interface CableDraft {
  deviceId: string
  portId: string
}

export interface Viewport {
  x: number
  y: number
  zoom: number
}

/**
 * A link already drawn on a logical canvas, offered as a starting patch.
 * Endpoints are canvas node ids, matched against `RackDevice.nodeId`.
 */
export interface NetworkLinkHint {
  from: string
  to: string
  type?: CableType
  label?: string
}

export interface NewInventoryDevice {
  label: string
  type?: string | null
  ip?: string | null
  mac?: string | null
}

interface RackState {
  /** Design currently loaded. Null before the first `loadDesign`. */
  designId: string | null
  racks: Rack[]
  devices: RackDevice[]
  cables: Cable[]
  inventory: InventoryDevice[]
  viewport: Viewport

  loading: boolean
  loadError: boolean
  hasUnsavedChanges: boolean
  /**
   * Bumped on every user edit. Autosave debounces on this rather than on the
   * arrays themselves, so a status refresh can't keep re-arming the timer.
   */
  editSeq: number

  // UI
  selectedDeviceId: string | null
  selectedRackId: string | null
  /** Cable picked in patch mode, so Delete/Backspace can unplug it. */
  selectedCableId: string | null
  hoveredDeviceId: string | null
  cableVisibility: CableVisibility
  /**
   * What the visibility was before patch mode forced cables on, so leaving
   * patch mode puts the canvas back the way the user had it. Cleared as soon
   * as the user picks a visibility by hand — their choice outlives the mode.
   */
  cableVisibilityBeforePatch: CableVisibility | null
  /** Port-picking mode: drag port to port, or click one then another. */
  cableMode: boolean
  cableDraft: CableDraft | null
  /**
   * A patch being dragged out of `cableDraft`'s port. `pointer` is in flow
   * coordinates, so the rubber band lives in the same space as the cables.
   * `moved` separates a drag from a plain click on the same port.
   */
  cableDrag: { pointer: { x: number; y: number } | null; moved: boolean } | null
  /**
   * Open editor dialogs. Device and rack settings live in modals, so any
   * component (sidebar, canvas, header) can open them without prop drilling.
   * `deviceId: null` means "add a device".
   */
  deviceEditor: { deviceId: string | null } | null
  rackEditorId: string | null

  // Persistence
  loadDesign: (designId: string) => Promise<void>
  refreshInventory: () => Promise<void>
  save: () => Promise<boolean>
  markSaved: () => void
  /** Add an inventory entry by hand, for hardware no scan can find. */
  createInventoryDevice: (input: NewInventoryDevice) => Promise<InventoryDevice | null>

  // Racks
  addRack: (partial?: Partial<Rack>) => string
  updateRack: (id: string, patch: Partial<Omit<Rack, 'id'>>) => void
  updateRackStyle: (id: string, patch: Partial<RackStyle>) => void
  moveRack: (id: string, position: { x: number; y: number }) => void
  /** Removes the rack and every device mounted in it (inventory untouched). */
  removeRack: (id: string) => void

  // Devices
  /**
   * Mount an inventory entry. Returns the new device id, or null if no room.
   * `faceplateId` overrides the one suggested from the discovery type.
   */
  mountFromInventory: (
    inventoryId: string,
    rackId: string,
    desired: Partial<Placement> & { faceplateId?: string },
  ) => string | null
  /** Mount a rack-only accessory (blank panel, shelf…). */
  mountAccessory: (faceplateId: string, rackId: string, desired: Partial<Placement>) => string | null
  moveDevice: (deviceId: string, rackId: string, desired: Placement) => boolean
  /**
   * Patch a mounted device. A geometry change that no longer fits where it is
   * relocates to the nearest free slot rather than being dropped; `false` means
   * the rack had no room at all and nothing changed.
   */
  updateDevice: (id: string, patch: Partial<Omit<RackDevice, 'id' | 'ports'>>) => boolean
  /** Unmounts from the rack. The inventory entry survives. */
  unmountDevice: (id: string) => void
  /** Swaps the plate, resizing to its U height — relocating if need be. */
  applyFaceplate: (deviceId: string, faceplateId: string) => boolean

  // Ports
  addPort: (deviceId: string, port: Omit<Port, 'id'>) => void
  updatePort: (deviceId: string, portId: string, patch: Partial<Omit<Port, 'id'>>) => void
  removePort: (deviceId: string, portId: string) => void
  /** Replace the whole port list, keeping ids of ports that carry one. */
  setPorts: (deviceId: string, ports: (Port | Omit<Port, 'id'>)[]) => void

  // Cables
  addCable: (
    from: CableDraft,
    to: CableDraft,
    options?: { type?: CableType; color?: string; label?: string },
  ) => string | null
  updateCable: (id: string, patch: Partial<Omit<Cable, 'id'>>) => void
  removeCable: (id: string) => void
  /**
   * Seed patches from the logical canvas. Idempotent: a device pair already
   * cabled is skipped, so re-running after racking more gear adds only what is
   * missing instead of doubling what is there.
   */
  importCablesFromNetwork: (hints: NetworkLinkHint[]) => number

  // UI actions
  setViewport: (v: Viewport) => void
  selectDevice: (id: string | null) => void
  selectRack: (id: string | null) => void
  selectCable: (id: string | null) => void
  /** Unplug whatever is selected. No-op when nothing is. */
  removeSelectedCable: () => void
  hoverDevice: (id: string | null) => void
  setCableVisibility: (v: CableVisibility) => void
  toggleCableMode: () => void
  pickPort: (deviceId: string, portId: string) => void
  /**
   * Press on a port: arms it as the cable source, or — when another port is
   * already armed — closes the patch, so click-then-click still works.
   */
  startCableDrag: (deviceId: string, portId: string) => void
  moveCableDrag: (pointer: { x: number; y: number }) => void
  /** Release: patch onto `target`, or drop the draft if the pointer travelled. */
  endCableDrag: (target: CableDraft | null) => void
  cancelCableDraft: () => void
  openDeviceEditor: (deviceId?: string | null) => void
  closeDeviceEditor: () => void
  openRackEditor: (rackId: string) => void
  closeRackEditor: () => void
  /** Seed the demo rack. Used by tests and by the empty-canvas sample button. */
  loadDemo: () => void
  reset: () => void
}

function withIds(ports: Omit<Port, 'id'>[]): Port[] {
  return ports.map((p) => ({ ...p, id: generateUUID() }))
}

function emptyState() {
  return {
    designId: null,
    racks: [] as Rack[],
    devices: [] as RackDevice[],
    cables: [] as Cable[],
    inventory: [] as InventoryDevice[],
    viewport: { ...DEFAULT_VIEWPORT },
    loading: false,
    loadError: false,
    hasUnsavedChanges: false,
    editSeq: 0,
    selectedDeviceId: null,
    selectedRackId: null,
    selectedCableId: null,
    hoveredDeviceId: null,
    cableVisibility: 'hover' as CableVisibility,
    cableVisibilityBeforePatch: null,
    cableMode: false,
    cableDraft: null,
    cableDrag: null,
    deviceEditor: null,
    rackEditorId: null,
  }
}

/**
 * Which devices in `inventory` are already mounted in this design.
 * Recomputed on every load and mount so the tray never goes stale.
 */
function withRackedFlags(inventory: InventoryDevice[], devices: RackDevice[]): InventoryDevice[] {
  const mounted = new Set(devices.map((d) => d.deviceId).filter(Boolean))
  return inventory.map((item) => ({ ...item, racked: mounted.has(item.id) }))
}

export const useRackStore = create<RackState>((set, get) => {
  /** Apply a state patch and mark the canvas dirty. */
  const edit = (patch: Partial<RackState> | ((s: RackState) => Partial<RackState>)) =>
    set((s) => ({
      ...(typeof patch === 'function' ? patch(s) : patch),
      hasUnsavedChanges: true,
      editSeq: s.editSeq + 1,
    }))

  return {
    ...emptyState(),

    // --- Persistence --------------------------------------------------------
    loadDesign: async (designId) => {
      set({ ...emptyState(), designId, loading: true })
      try {
        if (STANDALONE) {
          const stored = standaloneStorage.loadRackCanvas(designId)
          const devices = stored?.devices ?? []
          set({
            racks: stored?.racks ?? [],
            devices,
            cables: stored?.cables ?? [],
            inventory: withRackedFlags(stored?.inventory ?? [], devices),
            viewport: stored?.viewport ?? { ...DEFAULT_VIEWPORT },
            loading: false,
            hasUnsavedChanges: false,
          })
          return
        }

        const [state, inventory] = await Promise.all([
          racksApi.load(designId),
          racksApi.inventory(designId),
        ])
        // A design switch may have completed while these were in flight.
        if (get().designId !== designId) return
        const devices = state.data.devices.map(toRackDevice)
        set({
          racks: state.data.racks.map(toRack),
          devices,
          cables: state.data.cables.map(toCable),
          inventory: withRackedFlags(inventory.data.items.map(toInventoryDevice), devices),
          viewport: {
            x: state.data.viewport?.x ?? 0,
            y: state.data.viewport?.y ?? 0,
            zoom: state.data.viewport?.zoom ?? 1,
          },
          loading: false,
          hasUnsavedChanges: false,
        })
      } catch {
        if (get().designId !== designId) return
        set({ loading: false, loadError: true })
      }
    },

    refreshInventory: async () => {
      const { designId, devices } = get()
      if (!designId || STANDALONE) return
      try {
        const res = await racksApi.inventory(designId)
        if (get().designId !== designId) return
        set({ inventory: withRackedFlags(res.data.items.map(toInventoryDevice), devices) })
      } catch {
        // The tray keeps whatever it already had; racking still works.
      }
    },

    save: async () => {
      const { designId, racks, devices, cables, viewport, inventory } = get()
      if (!designId) return false
      try {
        if (STANDALONE) {
          standaloneStorage.saveRackCanvas(designId, { racks, devices, cables, viewport, inventory })
        } else {
          await racksApi.save(buildSavePayload(designId, racks, devices, cables, viewport))
        }
        set({ hasUnsavedChanges: false })
        return true
      } catch {
        return false
      }
    },

    markSaved: () => set({ hasUnsavedChanges: false }),

    createInventoryDevice: async ({ label, type = null, ip = null, mac = null }) => {
      const item: InventoryDevice = {
        id: generateUUID(),
        label,
        type,
        ip,
        status: 'unknown',
        nodeId: null,
        racked: false,
        suggestedFaceplateId: suggestFaceplate(type),
      }
      if (!STANDALONE) {
        try {
          const res = await scanApi.createPending({
            hostname: label,
            ip,
            mac,
            suggested_type: type,
            // Files it under "Rack devices" in the Device Inventory, and keeps
            // it off the logical canvases.
            discovery_source: 'rack',
          })
          item.id = res.data.id
        } catch {
          return null
        }
      }
      // Standalone keeps its inventory in the rack canvas blob, so this entry is
      // only durable once the canvas is saved.
      edit((s) => ({ inventory: [...s.inventory, item] }))
      return item
    },

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
      edit((s) => ({ racks: [...s.racks, rack], selectedRackId: id }))
      return id
    },

    updateRack: (id, patch) =>
      edit((s) => ({ racks: s.racks.map((r) => (r.id === id ? { ...r, ...patch } : r)) })),

    updateRackStyle: (id, patch) =>
      edit((s) => ({
        racks: s.racks.map((r) => (r.id === id ? { ...r, style: { ...r.style, ...patch } } : r)),
      })),

    moveRack: (id, position) =>
      edit((s) => ({ racks: s.racks.map((r) => (r.id === id ? { ...r, position } : r)) })),

    removeRack: (id) =>
      edit((s) => {
        const doomed = new Set(s.devices.filter((d) => d.rackId === id).map((d) => d.id))
        const devices = s.devices.filter((d) => d.rackId !== id)
        return {
          racks: s.racks.filter((r) => r.id !== id),
          devices,
          cables: s.cables.filter(
            (c) => !doomed.has(c.from.deviceId) && !doomed.has(c.to.deviceId),
          ),
          inventory: withRackedFlags(s.inventory, devices),
          selectedRackId: s.selectedRackId === id ? null : s.selectedRackId,
          rackEditorId: s.rackEditorId === id ? null : s.rackEditorId,
          deviceEditor: s.deviceEditor && doomed.has(s.deviceEditor.deviceId ?? '') ? null : s.deviceEditor,
        }
      }),

    // --- Devices ------------------------------------------------------------
    mountFromInventory: (inventoryId, rackId, desired) => {
      const { racks, devices, inventory } = get()
      const rack = racks.find((r) => r.id === rackId)
      const item = inventory.find((i) => i.id === inventoryId)
      if (!rack || !item) return null

      const plate = getFaceplate(desired.faceplateId ?? item.suggestedFaceplateId)
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
        deviceId: item.id,
        nodeId: item.nodeId,
        label: item.label,
        status: item.status,
        faceplateId: plate.id,
        ports: withIds(plate.ports),
        ...slot,
      }
      edit((s) => {
        const next = [...s.devices, device]
        return {
          devices: next,
          inventory: withRackedFlags(s.inventory, next),
          selectedDeviceId: device.id,
        }
      })
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
        deviceId: null,
        nodeId: null,
        label: plate.label,
        status: 'unknown',
        faceplateId: plate.id,
        ports: withIds(plate.ports),
        ...slot,
      }
      edit((s) => ({ devices: [...s.devices, device], selectedDeviceId: device.id }))
      return device.id
    },

    moveDevice: (deviceId, rackId, desired) => {
      const { racks, devices } = get()
      const rack = racks.find((r) => r.id === rackId)
      if (!rack) return false
      if (!canPlace(rack, devices, desired, deviceId)) return false
      edit((s) => ({
        devices: s.devices.map((d) => (d.id === deviceId ? { ...d, rackId, ...desired } : d)),
      }))
      return true
    },

    updateDevice: (id, patch) => {
      const { devices, racks } = get()
      const device = devices.find((d) => d.id === id)
      const rack = device && racks.find((r) => r.id === (patch.rackId ?? device.rackId))
      if (!device || !rack) return false

      const next = { ...device, ...patch }
      const geometryChanged =
        next.uStart !== device.uStart ||
        next.uHeight !== device.uHeight ||
        next.colStart !== device.colStart ||
        next.colSpan !== device.colSpan
      if (geometryChanged && !canPlace(rack, devices, next, id)) {
        // Growing a device usually collides with whatever sits above it. Move it
        // to the nearest slot that takes the new size instead of ignoring the
        // edit — a silent no-op reads as "the field is locked".
        const slot = findSlot(rack, devices, next, id)
        if (!slot) return false
        Object.assign(next, slot)
      }
      edit((s) => ({ devices: s.devices.map((d) => (d.id === id ? next : d)) }))
      return true
    },

    unmountDevice: (id) =>
      edit((s) => {
        const devices = s.devices.filter((d) => d.id !== id)
        return {
          devices,
          cables: s.cables.filter((c) => c.from.deviceId !== id && c.to.deviceId !== id),
          inventory: withRackedFlags(s.inventory, devices),
          selectedDeviceId: s.selectedDeviceId === id ? null : s.selectedDeviceId,
          deviceEditor: s.deviceEditor?.deviceId === id ? null : s.deviceEditor,
        }
      }),

    applyFaceplate: (deviceId, faceplateId) => {
      const { devices, racks } = get()
      const device = devices.find((d) => d.id === deviceId)
      const rack = device && racks.find((r) => r.id === device.rackId)
      if (!device || !rack) return false

      const plate = getFaceplate(faceplateId)
      const resized = {
        ...device,
        faceplateId,
        uHeight: plate.uHeight,
        colSpan: plate.colSpan,
        colStart: Math.min(device.colStart, RACK_COLUMNS - plate.colSpan),
        ports: withIds(plate.ports),
      }
      if (!canPlace(rack, devices, resized, deviceId)) {
        // A taller plate almost always overlaps the neighbour above. Relocate
        // rather than keep the old height — otherwise swapping a 1U plate for a
        // 2U one looks like it did nothing.
        const slot = findSlot(rack, devices, resized, deviceId)
        if (!slot) return false
        Object.assign(resized, slot)
      }
      edit((s) => ({
        devices: s.devices.map((d) => (d.id === deviceId ? resized : d)),
        // The old ports are gone, so their patches have no endpoint left.
        cables: s.cables.filter((c) => c.from.deviceId !== deviceId && c.to.deviceId !== deviceId),
      }))
      return true
    },

    // --- Ports --------------------------------------------------------------
    addPort: (deviceId, port) =>
      edit((s) => ({
        devices: s.devices.map((d) =>
          d.id === deviceId ? { ...d, ports: [...d.ports, { ...port, id: generateUUID() }] } : d,
        ),
      })),

    updatePort: (deviceId, portId, patch) =>
      edit((s) => ({
        devices: s.devices.map((d) =>
          d.id === deviceId
            ? { ...d, ports: d.ports.map((p) => (p.id === portId ? { ...p, ...patch } : p)) }
            : d,
        ),
      })),

    removePort: (deviceId, portId) =>
      edit((s) => ({
        devices: s.devices.map((d) =>
          d.id === deviceId ? { ...d, ports: d.ports.filter((p) => p.id !== portId) } : d,
        ),
        cables: s.cables.filter(
          (c) =>
            !(c.from.deviceId === deviceId && c.from.portId === portId) &&
            !(c.to.deviceId === deviceId && c.to.portId === portId),
        ),
      })),

    setPorts: (deviceId, ports) =>
      edit((s) => {
        const next: Port[] = ports.map((p) => ('id' in p ? p : { ...p, id: generateUUID() }))
        const kept = new Set(next.map((p) => p.id))
        return {
          devices: s.devices.map((d) => (d.id === deviceId ? { ...d, ports: next } : d)),
          cables: s.cables.filter(
            (c) =>
              !(c.from.deviceId === deviceId && !kept.has(c.from.portId)) &&
              !(c.to.deviceId === deviceId && !kept.has(c.to.portId)),
          ),
        }
      }),

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
      edit((s) => ({ cables: [...s.cables, cable] }))
      return cable.id
    },

    updateCable: (id, patch) =>
      edit((s) => ({ cables: s.cables.map((c) => (c.id === id ? { ...c, ...patch } : c)) })),

    removeCable: (id) =>
      edit((s) => ({
        cables: s.cables.filter((c) => c.id !== id),
        selectedCableId: s.selectedCableId === id ? null : s.selectedCableId,
      })),

    importCablesFromNetwork: (hints) => {
      const { devices } = get()
      // Idempotent by construction rather than by a "done" flag: a flag lives in
      // memory only, so a reload re-armed the import and every logical link got
      // a second cable on the next free pair of ports. A pair already patched is
      // skipped instead, whichever ports carry it, which also makes a re-run
      // after racking more gear do the useful half of the work.
      const pairKey = (x: string, y: string) => [x, y].sort().join('|')
      const patched = new Set(get().cables.map((c) => pairKey(c.from.deviceId, c.to.deviceId)))

      let created = 0
      for (const hint of hints) {
        const a = devices.find((d) => d.nodeId === hint.from)
        const b = devices.find((d) => d.nodeId === hint.to)
        if (!a || !b || patched.has(pairKey(a.id, b.id))) continue
        const usedPorts = new Set(
          get().cables.flatMap((c) => [
            `${c.from.deviceId}:${c.from.portId}`,
            `${c.to.deviceId}:${c.to.portId}`,
          ]),
        )
        // Prefer a port the cable could actually be plugged into: a fibre link
        // landing on two RJ45 jacks draws an amber run across copper ports. Any
        // free port still beats no patch at all when the plate has none.
        const freePort = (device: typeof a) => {
          const free = device.ports.filter((p) => !usedPorts.has(`${device.id}:${p.id}`))
          return free.find((p) => PORT_CABLE_TYPE[p.type] === hint.type) ?? free[0]
        }
        const pa = freePort(a)
        const pb = freePort(b)
        if (!pa || !pb) continue
        const id = get().addCable(
          { deviceId: a.id, portId: pa.id },
          { deviceId: b.id, portId: pb.id },
          { type: hint.type, label: hint.label },
        )
        if (id) {
          created++
          patched.add(pairKey(a.id, b.id))
        }
      }
      return created
    },

    // --- UI -----------------------------------------------------------------
    // Pan/zoom is persisted, but nudging the view is not an edit worth a Save
    // badge — the logical canvas treats the viewport the same way.
    setViewport: (v) => set({ viewport: v }),
    selectDevice: (id) => set({ selectedDeviceId: id, selectedRackId: null, selectedCableId: null }),
    selectRack: (id) => set({ selectedRackId: id, selectedDeviceId: null, selectedCableId: null }),
    // A cable and a mount both drive the right rail, so picking one drops the
    // other — two panels can't share the slot.
    selectCable: (id) =>
      set(id ? { selectedCableId: id, selectedDeviceId: null, selectedRackId: null } : { selectedCableId: null }),

    removeSelectedCable: () => {
      const id = get().selectedCableId
      if (!id) return
      get().removeCable(id)
    },
    hoverDevice: (id) => set({ hoveredDeviceId: id }),
    setCableVisibility: (v) => set({ cableVisibility: v, cableVisibilityBeforePatch: null }),

    toggleCableMode: () =>
      set((s) => {
        const entering = !s.cableMode
        return {
          cableMode: entering,
          cableDraft: null,
          cableDrag: null,
          selectedCableId: null,
          // Patch mode forces every cable on; leaving it hands the canvas back
          // to whatever the user was looking at before.
          cableVisibility: entering
            ? 'always'
            : (s.cableVisibilityBeforePatch ?? s.cableVisibility),
          cableVisibilityBeforePatch: entering ? s.cableVisibility : null,
        }
      }),

    pickPort: (deviceId, portId) => {
      const { cableDraft } = get()
      if (!cableDraft) {
        set({ cableDraft: { deviceId, portId } })
        return
      }
      get().addCable(cableDraft, { deviceId, portId })
      set({ cableDraft: null })
    },

    startCableDrag: (deviceId, portId) => {
      const { cableDraft } = get()
      if (cableDraft) {
        const samePort = cableDraft.deviceId === deviceId && cableDraft.portId === portId
        // Pressing the armed port again disarms it; pressing another closes the
        // patch — that is the click-then-click flow, kept alongside dragging.
        if (!samePort) get().addCable(cableDraft, { deviceId, portId })
        set({ cableDraft: null, cableDrag: null })
        return
      }
      set({ cableDraft: { deviceId, portId }, cableDrag: { pointer: null, moved: false } })
    },

    moveCableDrag: (pointer) => {
      if (!get().cableDrag) return
      set({ cableDrag: { pointer, moved: true } })
    },

    endCableDrag: (target) => {
      const { cableDrag, cableDraft } = get()
      if (!cableDrag) return
      const onAnotherPort =
        target &&
        cableDraft &&
        (target.deviceId !== cableDraft.deviceId || target.portId !== cableDraft.portId)
      if (onAnotherPort) {
        get().addCable(cableDraft, target)
        set({ cableDraft: null, cableDrag: null })
        return
      }
      // A drag released on nothing is a cancel; a press that never moved is the
      // first half of a click-then-click patch, so the source stays armed.
      set(cableDrag.moved ? { cableDraft: null, cableDrag: null } : { cableDrag: null })
    },

    cancelCableDraft: () => set({ cableDraft: null, cableDrag: null }),

    openDeviceEditor: (deviceId = null) =>
      set({ deviceEditor: { deviceId }, selectedDeviceId: deviceId }),
    closeDeviceEditor: () => set({ deviceEditor: null }),
    openRackEditor: (rackId) => set({ rackEditorId: rackId, selectedRackId: rackId }),
    closeRackEditor: () => set({ rackEditorId: null }),

    loadDemo: () => {
      const devices = demoDevices()
      set({
        ...emptyState(),
        designId: get().designId,
        racks: demoRacks(),
        devices,
        cables: demoCables(),
        inventory: withRackedFlags(demoInventory(), devices),
        hasUnsavedChanges: true,
      })
    },

    reset: () => set(emptyState()),
  }
})

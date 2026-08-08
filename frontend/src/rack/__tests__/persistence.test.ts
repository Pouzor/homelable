import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useRackStore } from '../store'

const load = vi.fn()
const inventory = vi.fn()
const save = vi.fn()
const createPending = vi.fn()

vi.mock('@/api/client', () => ({
  racksApi: {
    load: (...args: unknown[]) => load(...args),
    inventory: (...args: unknown[]) => inventory(...args),
    save: (...args: unknown[]) => save(...args),
  },
  scanApi: {
    createPending: (...args: unknown[]) => createPending(...args),
  },
}))

const store = () => useRackStore.getState()

const apiState = {
  racks: [
    {
      id: 'r1',
      design_id: 'd1',
      name: 'Main',
      u_height: 12,
      width_standard: '19',
      numbering: 'bottom-up',
      location: null,
      style: {},
      pos_x: 0,
      pos_y: 0,
    },
  ],
  devices: [
    {
      id: 'dev1',
      design_id: 'd1',
      rack_id: 'r1',
      device_id: 'inv1',
      node_id: null,
      label: 'sw-24',
      u_start: 4,
      u_height: 1,
      col_start: 0,
      col_span: 12,
      faceplate_id: 'switch-24',
      color: null,
      status: 'online',
      ports: [{ id: 'p1', label: '1', type: 'rj45', x: 0.3, y: 0.5 }],
    },
  ],
  cables: [],
  viewport: { x: 5, y: 6, zoom: 0.8 },
}

const apiInventory = {
  items: [
    {
      id: 'inv1',
      label: 'sw-24',
      suggested_type: 'switch',
      ip: '192.168.1.2',
      status: 'approved',
      discovery_source: 'arp',
      node_id: null,
      node_status: null,
      racked: false,
    },
    {
      id: 'inv2',
      label: 'nas',
      suggested_type: 'nas',
      ip: '192.168.1.9',
      status: 'approved',
      discovery_source: 'arp',
      node_id: 'node2',
      node_status: 'online',
      racked: false,
    },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  useRackStore.getState().reset()
  load.mockResolvedValue({ data: apiState })
  inventory.mockResolvedValue({ data: apiInventory })
  save.mockResolvedValue({ data: { saved: true } })
})

describe('loadDesign', () => {
  it('pulls state and inventory for the design', async () => {
    await store().loadDesign('d1')
    expect(load).toHaveBeenCalledWith('d1')
    expect(inventory).toHaveBeenCalledWith('d1')
    expect(store().designId).toBe('d1')
    expect(store().racks.map((r) => r.name)).toEqual(['Main'])
    expect(store().devices[0].label).toBe('sw-24')
    expect(store().viewport).toEqual({ x: 5, y: 6, zoom: 0.8 })
  })

  it('lands clean — a fresh load is not an unsaved change', async () => {
    await store().loadDesign('d1')
    expect(store().hasUnsavedChanges).toBe(false)
    expect(store().loading).toBe(false)
  })

  it('recomputes racked flags from the loaded mounts, not the server hint', async () => {
    await store().loadDesign('d1')
    expect(store().inventory.find((i) => i.id === 'inv1')!.racked).toBe(true)
    expect(store().inventory.find((i) => i.id === 'inv2')!.racked).toBe(false)
  })

  it('surfaces a failed load instead of showing an empty canvas as success', async () => {
    load.mockRejectedValue(new Error('boom'))
    await store().loadDesign('d1')
    expect(store().loadError).toBe(true)
    expect(store().loading).toBe(false)
  })

  it('clears the previous design before loading the next one', async () => {
    await store().loadDesign('d1')
    load.mockResolvedValue({ data: { ...apiState, racks: [], devices: [] } })
    inventory.mockResolvedValue({ data: { items: [] } })
    await store().loadDesign('d2')
    expect(store().racks).toEqual([])
    expect(store().devices).toEqual([])
  })
})

describe('save', () => {
  it('refuses to save before a design is loaded', async () => {
    expect(await store().save()).toBe(false)
    expect(save).not.toHaveBeenCalled()
  })

  it('posts the full state and clears the dirty flag', async () => {
    await store().loadDesign('d1')
    store().addRack({ id: 'r2', name: 'Second' })
    expect(store().hasUnsavedChanges).toBe(true)

    expect(await store().save()).toBe(true)
    const payload = save.mock.calls[0][0]
    expect(payload.design_id).toBe('d1')
    expect(payload.racks.map((r: { id: string }) => r.id)).toEqual(['r1', 'r2'])
    expect(payload.devices[0].u_start).toBe(4)
    expect(store().hasUnsavedChanges).toBe(false)
  })

  it('keeps the canvas dirty when the save fails', async () => {
    await store().loadDesign('d1')
    store().addRack()
    save.mockRejectedValue(new Error('nope'))
    expect(await store().save()).toBe(false)
    expect(store().hasUnsavedChanges).toBe(true)
  })

  it('saves when the design it was told to save is the one loaded', async () => {
    await store().loadDesign('d1')
    expect(await store().save('d1')).toBe(true)
    expect(save.mock.calls[0][0].design_id).toBe('d1')
  })

  it('writes nothing when the store has moved on to another design', async () => {
    // The design-switch flow saves the old design; if the store already holds
    // the new one, saving would persist it under the wrong id.
    await store().loadDesign('d1')
    store().addRack()
    expect(await store().save('d-other')).toBe(false)
    expect(save).not.toHaveBeenCalled()
    expect(store().hasUnsavedChanges).toBe(true)
  })
})

describe('createInventoryDevice', () => {
  it('creates the entry in the Device Inventory, tagged as rack gear', async () => {
    await store().loadDesign('d1')
    createPending.mockResolvedValue({ data: { id: 'inv-new', hostname: 'patch panel' } })

    const created = await store().createInventoryDevice({ label: 'patch panel' })
    expect(createPending).toHaveBeenCalledWith({
      hostname: 'patch panel',
      ip: null,
      mac: null,
      suggested_type: null,
      // Files it under the inventory's "Rack devices" filter and keeps it off
      // the logical canvases.
      discovery_source: 'rack',
    })
    expect(created!.id).toBe('inv-new')
    expect(store().inventory.some((i) => i.id === 'inv-new')).toBe(true)
    expect(store().hasUnsavedChanges).toBe(true)
  })

  it('adds nothing when the backend refuses', async () => {
    await store().loadDesign('d1')
    const before = store().inventory.length
    createPending.mockRejectedValue(new Error('nope'))

    expect(await store().createInventoryDevice({ label: 'ghost' })).toBeNull()
    expect(store().inventory).toHaveLength(before)
  })
})

describe('refreshInventory', () => {
  it('re-reads the tray without touching the mounts', async () => {
    await store().loadDesign('d1')
    inventory.mockResolvedValue({
      data: { items: [...apiInventory.items, { ...apiInventory.items[1], id: 'inv3', label: 'new box' }] },
    })

    await store().refreshInventory()
    expect(store().inventory.some((i) => i.id === 'inv3')).toBe(true)
    expect(store().devices).toHaveLength(1)
  })

  it('keeps the existing tray when the refresh fails', async () => {
    await store().loadDesign('d1')
    const before = store().inventory.length
    inventory.mockRejectedValue(new Error('offline'))
    await store().refreshInventory()
    expect(store().inventory).toHaveLength(before)
  })
})

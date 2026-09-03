/**
 * The device modal is the only editor for a mount — the rack canvas has no
 * right rail — so everything the old inspector did has to work from here.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { RackDeviceModal } from '../components/RackDeviceModal'
import { useRackStore } from '../store'

const createPending = vi.fn()
const pendingList = vi.fn()
const deletePending = vi.fn()

vi.mock('sonner', async () => (await import('@/test/mocks')).mockSonner())
vi.mock('@/api/client', () => ({
  racksApi: { load: vi.fn(), inventory: vi.fn(), save: vi.fn() },
  scanApi: {
    createPending: (...args: unknown[]) => createPending(...args),
    // The inventory entry is now picked in the Device Inventory modal, which
    // reads `pending_devices` itself rather than the rack's mirrored list.
    pending: (...args: unknown[]) => pendingList(...args),
    hidden: vi.fn().mockResolvedValue({ data: [] }),
    // Cleanup after a relink: the placeholder the rack created is dropped.
    deletePending: (...args: unknown[]) => deletePending(...args),
  },
}))

const store = () => useRackStore.getState()

beforeEach(() => {
  vi.clearAllMocks()
  store().loadDemo()
  pendingList.mockResolvedValue({ data: [] })
  deletePending.mockResolvedValue({ data: { deleted: true } })
})

/** Shape the Device Inventory modal expects for one of the rack's entries. */
function pendingRow(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    ip: null,
    hostname: id,
    mac: null,
    os: null,
    services: [],
    suggested_type: 'server',
    status: 'pending',
    discovery_source: 'arp',
    discovered_at: '2026-01-01T00:00:00Z',
    ...extra,
  }
}

/** Open the Device Inventory from the rack modal and click one of its cards. */
async function pickFromInventory(id: string, extra: Record<string, unknown> = {}) {
  pendingList.mockResolvedValue({ data: [pendingRow(id, extra)] })
  fireEvent.click(screen.getByLabelText('Device Inventory entry'))
  const card = await screen.findByTestId(`pending-card-${id}`)
  await act(async () => {
    fireEvent.click(card)
  })
}

function submit() {
  fireEvent.click(screen.getByRole('button', { name: /^(Add|Save)$/ }))
}

/** The plate is picked from the visual catalog, not a native select. */
function pickFaceplate(label: string) {
  fireEvent.click(screen.getByLabelText('Faceplate'))
  fireEvent.click(screen.getByRole('button', { name: label }))
}

describe('RackDeviceModal — nothing to edit', () => {
  it('renders nothing while no editor is open', () => {
    const { container } = render(<RackDeviceModal />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('RackDeviceModal — adding', () => {
  it('mounts an entry picked from the Device Inventory', async () => {
    store().openDeviceEditor()
    render(<RackDeviceModal />)

    const unracked = store().inventory.find((i) => !i.racked)!
    await pickFromInventory(unracked.id)
    submit()

    await waitFor(() =>
      expect(store().devices.some((d) => d.deviceId === unracked.id)).toBe(true),
    )
    // The mount is a rack row; the inventory entry itself stays, now flagged.
    expect(store().inventory.find((i) => i.id === unracked.id)!.racked).toBe(true)
    expect(store().deviceEditor).toBeNull()
  })

  it('takes the picked entry status instead of saving unknown over it', async () => {
    store().openDeviceEditor()
    const first = store().inventory.find((i) => !i.racked)!
    useRackStore.setState({
      inventory: store().inventory.map((i) =>
        i.id === first.id ? { ...i, status: 'online' as const } : i,
      ),
    })
    render(<RackDeviceModal />)

    // Picking and submitting without touching the Status select is the common
    // path — it used to commit `unknown` over the entry's live status.
    await pickFromInventory(first.id)
    submit()

    await waitFor(() => expect(store().deviceEditor).toBeNull())
    expect(store().devices.find((d) => d.deviceId === first.id)!.status).toBe('online')
  })

  it('refuses an entry already mounted in this design', async () => {
    const { toast } = await import('sonner')
    store().openDeviceEditor()
    const racked = store().inventory.find((i) => i.racked)!
    render(<RackDeviceModal />)

    // The Device Inventory lists every device, racked or not — the rack side is
    // what knows one is already mounted here, and one mount per entry is the rule.
    await pickFromInventory(racked.id)

    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('already mounted'))
    expect(screen.getByLabelText('Device Inventory entry')).toHaveAttribute('data-device-id', '')
  })

  it('refuses a device the rack inventory does not carry', async () => {
    const { toast } = await import('sonner')
    store().openDeviceEditor()
    render(<RackDeviceModal />)

    // The two lists come from different endpoints: a row can be in the Device
    // Inventory and absent from the rack's (hidden there, or a kind no rack can
    // hold). Refuse it rather than mount a ghost with no entry behind it.
    await pickFromInventory('dev-ghost')

    expect(toast.error).toHaveBeenCalledWith('That device cannot be mounted in a rack')
    expect(screen.getByLabelText('Device Inventory entry')).toHaveAttribute('data-device-id', '')
  })

  it('creates nothing in the inventory when the rack has no room', async () => {
    store().openDeviceEditor()
    const rack = store().racks[0]
    // A 1U rack with its only slot taken: the mount cannot succeed.
    useRackStore.setState({
      racks: [{ ...rack, uHeight: 1 }],
      devices: [
        {
          id: 'blocker',
          rackId: rack.id,
          deviceId: null,
          nodeId: null,
          label: 'blocker',
          faceplateId: 'blank-1u',
          uStart: 1,
          uHeight: 1,
          colStart: 0,
          colSpan: 12,
          status: 'unknown',
          ports: [],
        },
      ],
      cables: [],
    })
    const inventoryBefore = store().inventory.length
    render(<RackDeviceModal />)

    fireEvent.click(screen.getByRole('button', { name: 'New device' }))
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'orphan' } })
    // The submit path is async (it may POST), so let it settle before asserting.
    await act(async () => submit())

    const { toast } = await import('sonner')
    expect(toast.error).toHaveBeenCalled()
    // The row is POSTed before the mount, so a late failure would strand it —
    // and strand another one on every retry.
    expect(createPending).not.toHaveBeenCalled()
    expect(store().inventory).toHaveLength(inventoryBefore)
    expect(store().deviceEditor).not.toBeNull()
  })

  it('blames the missing entry, not the rack, when the pick is gone', async () => {
    store().openDeviceEditor()
    const picked = store().inventory.find((i) => !i.racked)!
    render(<RackDeviceModal />)

    await pickFromInventory(picked.id)
    // Racked from another modal, or purged from the inventory, while this one
    // was open: the mount fails, and it used to read "No free slot in this rack".
    act(() => {
      useRackStore.setState({ inventory: store().inventory.filter((i) => i.id !== picked.id) })
    })
    // The field drops back to its placeholder rather than holding a dead id…
    expect(screen.getByLabelText('Device Inventory entry')).toHaveAttribute('data-device-id', '')
    await act(async () => submit())

    // …so the error names the real cause instead of the rack's capacity.
    const { toast } = await import('sonner')
    expect(toast.error).toHaveBeenCalledWith('Pick a device from the inventory')
    expect(store().deviceEditor).not.toBeNull()
  })

  it('keeps the slot the mount picked instead of dragging it back', async () => {
    store().openDeviceEditor()
    const entry = store().inventory.find((i) => !i.racked)!
    render(<RackDeviceModal />)

    await pickFromInventory(entry.id)
    // U 1 is taken in the demo rack, so the mount relocates. Patching the form's
    // own geometry afterwards used to undo that, silently.
    fireEvent.change(screen.getByLabelText('U position'), { target: { value: '1' } })
    submit()

    await waitFor(() => expect(store().deviceEditor).toBeNull())
    const mounted = store().devices.find((d) => d.deviceId === entry.id)!
    const others = store().devices.filter((d) => d.id !== mounted.id && d.rackId === mounted.rackId)
    for (const other of others) {
      const overlaps =
        mounted.uStart < other.uStart + other.uHeight &&
        other.uStart < mounted.uStart + mounted.uHeight &&
        mounted.colStart < other.colStart + other.colSpan &&
        other.colStart < mounted.colStart + mounted.colSpan
      expect(overlaps).toBe(false)
    }
  })

  it('names the picked entry without repeating the IP', async () => {
    store().openDeviceEditor()
    useRackStore.setState({
      inventory: [
        {
          id: 'inv-ip',
          label: '192.168.1.63',
          type: 'server',
          ip: '192.168.1.63',
          status: 'unknown',
          nodeId: null,
          racked: false,
          suggestedFaceplateId: 'server-1u',
        },
      ],
    })
    render(<RackDeviceModal />)
    await pickFromInventory('inv-ip')

    // Regression: an IP-labelled entry read "192.168.1.63 · 192.168.1.63".
    const field = screen.getByLabelText('Device Inventory entry')
    expect(field).toHaveTextContent('192.168.1.63 · server')
    expect(field).not.toHaveTextContent('192.168.1.63 · 192.168.1.63')
  })

  it('lays the form out in two columns inside a NodeModal-sized dialog', () => {
    store().openDeviceEditor()
    render(<RackDeviceModal />)

    // Regression: a max-w-md dialog with one column pushed the port list — and
    // the Add button — below the fold on a laptop screen. Widened again when the
    // full-size faceplate moved under the form.
    expect(screen.getByRole('dialog')).toHaveClass('sm:max-w-5xl')
    const columns = document.querySelector('.sm\\:grid-cols-2')!
    expect(columns).not.toBeNull()
    // Fields on the left, ports on the right, both inside the same grid.
    expect(columns).toContainElement(screen.getByLabelText('Label'))
    expect(columns).toContainElement(screen.getByRole('button', { name: 'Add port' }))
  })

  it('offers a Width option for every plate width in the catalog', async () => {
    const { FACEPLATES } = await import('../faceplates')
    store().openDeviceEditor()
    render(<RackDeviceModal />)

    // A plate whose colSpan has no option (the sixth-width NAS did) leaves the
    // select blank and the field looks broken.
    const offered = [...screen.getByLabelText('Width').querySelectorAll('option')].map((o) =>
      Number(o.getAttribute('value')),
    )
    for (const span of new Set(FACEPLATES.map((f) => f.colSpan))) {
      expect(offered).toContain(span)
    }
  })

  it('creates a brand new inventory entry from the canvas and mounts it', async () => {
    createPending.mockResolvedValue({ data: { id: 'pending-1' } })
    store().openDeviceEditor()
    render(<RackDeviceModal />)

    fireEvent.click(screen.getByRole('button', { name: 'New device' }))
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'tape-lib' } })
    fireEvent.change(screen.getByLabelText('IP'), { target: { value: '192.168.1.99' } })
    submit()

    await waitFor(() => expect(createPending).toHaveBeenCalledTimes(1))
    expect(createPending).toHaveBeenCalledWith(
      expect.objectContaining({ hostname: 'tape-lib', ip: '192.168.1.99' }),
    )
    await waitFor(() =>
      expect(store().devices.some((d) => d.label === 'tape-lib')).toBe(true),
    )
    expect(store().inventory.some((i) => i.id === 'pending-1')).toBe(true)
  })

  it('types a canvas-created device from the plate it wears', async () => {
    createPending.mockResolvedValue({ data: { id: 'pending-pdu' } })
    store().openDeviceEditor()
    render(<RackDeviceModal />)

    fireEvent.click(screen.getByRole('button', { name: 'New device' }))
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'pdu-a' } })
    pickFaceplate('PDU 1U — 8 outlets')
    submit()

    // Nothing discovered this device, so the plate is what says what it is —
    // the row used to land in the Device Inventory with no type at all.
    await waitFor(() => expect(createPending).toHaveBeenCalledTimes(1))
    expect(createPending).toHaveBeenCalledWith(
      expect.objectContaining({ suggested_type: 'pdu', discovery_source: 'rack' }),
    )
    await waitFor(() => expect(store().deviceEditor).toBeNull())
    expect(store().inventory.find((i) => i.id === 'pending-pdu')!.type).toBe('pdu')
  })

  it('mounts an accessory without touching the inventory', async () => {
    const before = store().inventory.length
    store().openDeviceEditor()
    render(<RackDeviceModal />)

    fireEvent.click(screen.getByRole('button', { name: 'Accessory' }))
    pickFaceplate('Blank panel 1U')
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'filler' } })
    submit()

    await waitFor(() => expect(store().devices.some((d) => d.label === 'filler')).toBe(true))
    const mounted = store().devices.find((d) => d.label === 'filler')!
    expect(mounted.deviceId).toBeNull()
    expect(store().inventory).toHaveLength(before)
  })

  it('swaps to an accessory plate — and back — with the source', () => {
    store().openDeviceEditor()
    render(<RackDeviceModal />)

    fireEvent.click(screen.getByRole('button', { name: 'Accessory' }))
    expect(screen.getByLabelText('Faceplate')).toHaveAttribute('data-faceplate', 'blank-1u')
    // The picker then only offers rack furniture.
    fireEvent.click(screen.getByLabelText('Faceplate'))
    expect(screen.queryByRole('button', { name: 'Server 1U' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Shelf 1U' }))
    expect(screen.getByLabelText('Faceplate')).toHaveAttribute('data-faceplate', 'shelf-1u')

    fireEvent.click(screen.getByRole('button', { name: 'New device' }))
    expect(screen.getByLabelText('Faceplate')).toHaveAttribute('data-faceplate', 'server-1u')
  })

  it('offers "Check device" only once the pick resolves to a canvas node', async () => {
    store().openDeviceEditor()
    render(<RackDeviceModal />)

    // Nothing picked yet: there is no check to follow, so the option would lie.
    const select = screen.getByLabelText('Status')
    expect(select).not.toHaveTextContent('Check device')

    const linked = store().inventory.find((i) => !i.racked && i.nodeId)!
    await pickFromInventory(linked.id)
    expect(select).toHaveTextContent('Check device')
  })

  it('hides "Check device" for an entry with no canvas node behind it', async () => {
    store().openDeviceEditor()
    const orphan = store().inventory.find((i) => !i.racked)!
    useRackStore.setState({
      inventory: store().inventory.map((i) => (i.id === orphan.id ? { ...i, nodeId: null } : i)),
    })
    render(<RackDeviceModal />)

    await pickFromInventory(orphan.id)
    expect(screen.getByLabelText('Status')).not.toHaveTextContent('Check device')
  })

  it('mounts a device that follows its node check', async () => {
    store().openDeviceEditor()
    const linked = store().inventory.find((i) => !i.racked && i.nodeId)!
    render(<RackDeviceModal />)

    await pickFromInventory(linked.id)
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'auto' } })
    submit()

    await waitFor(() => expect(store().deviceEditor).toBeNull())
    // The mount stores the intent, not a colour — the LED is resolved from the
    // inventory's live `node_status` at render time.
    expect(store().devices.find((d) => d.deviceId === linked.id)!.status).toBe('auto')
  })
})

describe('RackDeviceModal — editing', () => {
  it('seeds every field from the mounted device', () => {
    store().openDeviceEditor('dev-pve1')
    render(<RackDeviceModal />)

    const device = store().devices.find((d) => d.id === 'dev-pve1')!
    expect(screen.getByLabelText('Label')).toHaveValue(device.label)
    expect(screen.getByLabelText('U position')).toHaveValue(device.uStart)
    expect(screen.getByLabelText('Height (U)')).toHaveValue(device.uHeight)
    expect(screen.getByLabelText('Faceplate')).toHaveAttribute(
      'data-faceplate',
      device.faceplateId,
    )
    // The old right-panel fields all moved here.
    expect(screen.getByLabelText('Status')).toBeInTheDocument()
    expect(screen.getByLabelText('Colour override')).toBeInTheDocument()
    expect(screen.getByText(`Ports (${device.ports.length})`)).toBeInTheDocument()
  })

  it('saves a port visibility override on the mount', async () => {
    store().openDeviceEditor('dev-pve1')
    render(<RackDeviceModal />)

    const select = screen.getByLabelText('Show ports on the canvas')
    expect(select).toHaveValue('auto')
    fireEvent.change(select, { target: { value: 'always' } })
    submit()

    await waitFor(() => expect(store().deviceEditor).toBeNull())
    expect(store().devices.find((d) => d.id === 'dev-pve1')!.portVisibility).toBe('always')
  })

  it('leaves the port visibility selector off an accessory', () => {
    // A shelf has no ports, so there is nothing to decide about.
    store().openDeviceEditor('dev-shelf')
    render(<RackDeviceModal />)
    expect(screen.queryByLabelText('Show ports on the canvas')).toBeNull()
  })

  it('saves label, status and geometry in one go', async () => {
    store().openDeviceEditor('dev-shelf')
    render(<RackDeviceModal />)

    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'kvm tray' } })
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'online' } })
    fireEvent.change(screen.getByLabelText('Height (U)'), { target: { value: '2' } })
    submit()

    await waitFor(() => expect(store().deviceEditor).toBeNull())
    const device = store().devices.find((d) => d.id === 'dev-shelf')!
    expect(device.label).toBe('kvm tray')
    expect(device.status).toBe('online')
    expect(device.uHeight).toBe(2)
  })

  it('applies a taller faceplate, height included', async () => {
    store().openDeviceEditor('dev-shelf')
    render(<RackDeviceModal />)

    // Regression: a 2U plate used to leave the device 1U, so 1U and 2U plates
    // rendered at the same height and the field looked locked.
    pickFaceplate('UPS 2U')
    expect(screen.getByLabelText('Height (U)')).toHaveValue(2)
    submit()

    await waitFor(() => expect(store().deviceEditor).toBeNull())
    const device = store().devices.find((d) => d.id === 'dev-shelf')!
    expect(device.faceplateId).toBe('ups-2u')
    expect(device.uHeight).toBe(2)
  })

  it('keeps the ports and cables when the plate choice is reverted', async () => {
    store().openDeviceEditor('dev-pve1')
    render(<RackDeviceModal />)

    const before = store().devices.find((d) => d.id === 'dev-pve1')!
    const cablesBefore = store().cables.filter(
      (c) => c.from.deviceId === 'dev-pve1' || c.to.deviceId === 'dev-pve1',
    )
    expect(cablesBefore.length).toBeGreaterThan(0)

    // Browse away and back. The plate is unchanged, so `applyFaceplate` is
    // skipped on save — reseeded port ids would then reach `setPorts` and take
    // every cable on the device down with them, with no warning shown.
    pickFaceplate('NAS 2U — 8 bays')
    pickFaceplate('Server 2U — 8 bays')
    expect(screen.queryByText(/replaces its ports/)).not.toBeInTheDocument()
    submit()

    await waitFor(() => expect(store().deviceEditor).toBeNull())
    const after = store().devices.find((d) => d.id === 'dev-pve1')!
    expect(after.ports.map((p) => p.id)).toEqual(before.ports.map((p) => p.id))
    expect(
      store().cables.filter(
        (c) => c.from.deviceId === 'dev-pve1' || c.to.deviceId === 'dev-pve1',
      ),
    ).toHaveLength(cablesBefore.length)
  })

  it('refuses a plate the rack cannot take instead of half-applying it', async () => {
    const { toast } = await import('sonner')
    store().openDeviceEditor('dev-pve1')
    render(<RackDeviceModal />)

    const before = store().devices.find((d) => d.id === 'dev-pve1')!
    // The demo rack's longest free run is 3U, so the 4U plate cannot be applied.
    // Shrinking the height then let `updateDevice` succeed on its own, and the
    // device ended up wearing its old plate with the new plate's ports.
    pickFaceplate('Storage 4U — 12 bays')
    fireEvent.change(screen.getByLabelText('Height (U)'), { target: { value: '1' } })
    submit()

    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    const after = store().devices.find((d) => d.id === 'dev-pve1')!
    expect(after.faceplateId).toBe(before.faceplateId)
    expect(after.ports.map((p) => p.id)).toEqual(before.ports.map((p) => p.id))
    expect(after.uHeight).toBe(before.uHeight)
    expect(store().deviceEditor).not.toBeNull()
  })

  it('edits the port list and commits it on save', async () => {
    store().openDeviceEditor('dev-pve1')
    render(<RackDeviceModal />)

    const before = store().devices.find((d) => d.id === 'dev-pve1')!.ports.length
    fireEvent.click(screen.getByRole('button', { name: 'Add port' }))
    expect(screen.getByText(`Ports (${before + 1})`)).toBeInTheDocument()
    submit()

    await waitFor(() =>
      expect(store().devices.find((d) => d.id === 'dev-pve1')!.ports).toHaveLength(before + 1),
    )
  })

  it('shows the plate full size instead of the thumbnail that never fit', () => {
    store().openDeviceEditor('dev-pve1')
    render(<RackDeviceModal />)

    // Regression: the plate used to be drawn at 160×18px inside the faceplate
    // button, where it lost its label and stacked its ports on one another.
    const stage = screen.getByTestId('faceplate-stage')
    expect(stage).toBeInTheDocument()
    expect(Number.parseFloat(stage.style.width)).toBeGreaterThan(200)
    expect(screen.getByLabelText('Faceplate').querySelector('svg')).toBeNull()
  })

  it('reveals the drag handles only once positioning is switched on', () => {
    store().openDeviceEditor('dev-pve1')
    render(<RackDeviceModal />)

    const ports = store().devices.find((d) => d.id === 'dev-pve1')!.ports
    expect(document.querySelectorAll('[data-port-handle]')).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: 'Position ports' }))
    expect(document.querySelectorAll('[data-port-handle]')).toHaveLength(ports.length)
  })

  it('has nothing to position on a plate with no port', async () => {
    store().openDeviceEditor('dev-pve1')
    render(<RackDeviceModal />)

    const ports = store().devices.find((d) => d.id === 'dev-pve1')!.ports
    for (const port of ports) {
      fireEvent.click(screen.getByLabelText(`Remove port ${port.label}`))
    }
    expect(screen.getByRole('button', { name: 'Position ports' })).toBeDisabled()
  })

  it('spreads added ports along the plate instead of stacking them', () => {
    store().openDeviceEditor('dev-pve1')
    render(<RackDeviceModal />)

    // Regression: every new port landed on the middle of the plate, so three
    // added ports drew as one socket. Each continues the row of the last.
    const before = store().devices.find((d) => d.id === 'dev-pve1')!.ports
    fireEvent.click(screen.getByRole('button', { name: 'Add port' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add port' }))
    fireEvent.click(screen.getByRole('button', { name: 'Position ports' }))

    const added = [...document.querySelectorAll<HTMLElement>('[data-port-handle]')].slice(
      before.length,
    )
    expect(added).toHaveLength(2)
    expect(added[0].style.left).not.toBe(added[1].style.left)
  })

  it('gives an accessory no port section at all', () => {
    const id = store().mountAccessory('shelf-1u', 'rack-main', { uStart: 6 })!
    store().openDeviceEditor(id)
    render(<RackDeviceModal />)

    // A shelf stands for no inventory row, so it has nothing to cable.
    expect(screen.queryByRole('button', { name: 'Add port' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Position ports' })).toBeNull()
    // The plate is still drawn: it is the preview of the accessory itself.
    expect(screen.getByTestId('faceplate-stage')).toBeInTheDocument()
  })

  it('keeps the port name field usable next to the type select', () => {
    store().openDeviceEditor('dev-pve1')
    render(<RackDeviceModal />)

    // Regression: both carried `w-full`, so the select ate the row and the name
    // field collapsed into an unlabelled box.
    const port = store().devices.find((d) => d.id === 'dev-pve1')!.ports[0]
    const name = screen.getByLabelText(`Port ${port.label} label`)
    expect(name).toHaveClass('flex-1', 'min-w-0')
    expect(name).not.toHaveClass('w-full')
    // The chip layout shortened the placeholder; the field must still be the
    // part of the row that stretches.
    expect(name).toHaveAttribute('placeholder', 'Name')
  })

  it('unmounts without dropping the inventory entry', async () => {
    store().openDeviceEditor('dev-pve1')
    render(<RackDeviceModal />)

    fireEvent.click(screen.getByRole('button', { name: /Unmount/ }))

    await waitFor(() => expect(store().devices.some((d) => d.id === 'dev-pve1')).toBe(false))
    expect(store().inventory.some((i) => i.id === 'inv-pve1')).toBe(true)
    expect(store().deviceEditor).toBeNull()
  })

  it('reports a resize the rack cannot take instead of failing silently', async () => {
    const { toast } = await import('sonner')
    store().openDeviceEditor('dev-pve1')
    render(<RackDeviceModal />)

    // The demo rack's longest free run is 3U.
    fireEvent.change(screen.getByLabelText('Height (U)'), { target: { value: '9' } })
    submit()

    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(store().deviceEditor).not.toBeNull()
    expect(store().devices.find((d) => d.id === 'dev-pve1')!.uHeight).toBe(2)
  })

  it('keeps "Check device" for a mount already linked to a node', () => {
    store().openDeviceEditor('dev-pve1')
    render(<RackDeviceModal />)

    expect(store().devices.find((d) => d.id === 'dev-pve1')!.nodeId).toBeTruthy()
    expect(screen.getByLabelText('Status')).toHaveTextContent('Check device')
  })

  it('drops a mount off the node check when the link is gone', async () => {
    store().openDeviceEditor('dev-pve1')
    // The canvas node was deleted (`node_id` is ON DELETE SET NULL) and the
    // inventory entry no longer resolves to one: nothing left to follow.
    useRackStore.setState({
      devices: store().devices.map((d) =>
        d.id === 'dev-pve1' ? { ...d, nodeId: null, status: 'auto' as const } : d,
      ),
      inventory: store().inventory.map((i) =>
        i.id === 'inv-pve1' ? { ...i, nodeId: null } : i,
      ),
    })
    render(<RackDeviceModal />)

    const select = screen.getByLabelText('Status')
    expect(select).not.toHaveTextContent('Check device')
    expect(select).toHaveValue('unknown')

    submit()
    await waitFor(() => expect(store().deviceEditor).toBeNull())
    expect(store().devices.find((d) => d.id === 'dev-pve1')!.status).toBe('unknown')
  })

  it('prints what the logical canvas knows about the mounted device', () => {
    store().openDeviceEditor('dev-pve1')
    render(<RackDeviceModal />)

    const entry = store().inventory.find((i) => i.id === 'inv-pve1')!
    const panel = screen.getByLabelText('Linked device')
    expect(panel).toHaveTextContent(entry.node!.hostname!)
    expect(panel).toHaveTextContent(entry.ip!)
    expect(panel).toHaveTextContent(entry.mac!)
    expect(panel).toHaveTextContent('proxmox')
  })

  it('leaves an accessory without a logical view — it stands for no device', () => {
    store().openDeviceEditor('dev-shelf')
    render(<RackDeviceModal />)

    expect(store().devices.find((d) => d.id === 'dev-shelf')!.deviceId).toBeNull()
    expect(screen.queryByLabelText('Linked device')).not.toBeInTheDocument()
  })

  /** A discovered row, offered in the inventory the picker reads. */
  function offerScannedRow() {
    useRackStore.setState((s) => ({
      inventory: [
        ...s.inventory,
        {
          id: 'inv-scanned',
          label: 'pdu-real',
          type: 'pdu',
          discoverySource: 'arp',
          ip: '192.168.1.60',
          mac: null,
          hostname: 'pdu.lan',
          os: null,
          services: [],
          status: 'online' as const,
          nodeId: 'node-pdu',
          node: {
            id: 'node-pdu',
            label: 'pdu-main',
            type: 'pdu',
            ip: '192.168.1.60',
            mac: null,
            hostname: 'pdu.lan',
            os: null,
            checkMethod: 'ping',
            designId: 'demo-network',
            designName: 'Network',
            lastSeen: null,
          },
          racked: false,
          suggestedFaceplateId: 'pdu-1u',
        },
      ],
    }))
  }

  it('repoints a mount at the inventory device the user picks', async () => {
    // `dev-pdu` was created from the rack: its entry is a placeholder with a
    // name and nothing else, and no IEEE or IP for the backend to guess from.
    store().openDeviceEditor('dev-pdu')
    render(<RackDeviceModal />)
    expect(screen.getByLabelText('Linked device')).not.toHaveTextContent('pdu.lan')

    act(() => offerScannedRow())
    fireEvent.click(screen.getByRole('button', { name: /Link to another device/ }))
    // By role: the plate preview draws the same label in its SVG artwork.
    const row = await screen.findByRole('button', { name: /pdu-real/ })
    await act(async () => {
      fireEvent.click(row)
    })

    const mount = store().devices.find((d) => d.id === 'dev-pdu')!
    expect(mount.deviceId).toBe('inv-scanned')
    expect(mount.nodeId).toBe('node-pdu')
    expect(screen.getByLabelText('Linked device')).toHaveTextContent('pdu.lan')
    // The form follows the plate's new name rather than saving the old one back.
    expect(screen.getByLabelText('Label')).toHaveValue('pdu-real')
  })

  it('offers "Check device" once a device with a node has been linked', async () => {
    store().openDeviceEditor('dev-pdu')
    render(<RackDeviceModal />)

    expect(screen.queryByRole('option', { name: /Check device/ })).not.toBeInTheDocument()

    act(() => offerScannedRow())
    await act(async () => {
      await store().relinkDevice('dev-pdu', 'inv-scanned')
    })

    await waitFor(() =>
      expect(screen.getByRole('option', { name: /Check device/ })).toBeInTheDocument(),
    )
  })

  it('does not offer linking while the mount is still being created', async () => {
    store().openDeviceEditor()
    render(<RackDeviceModal />)
    await pickFromInventory('inv-pdu')

    // Nothing to hang a link on yet: the mount does not exist.
    expect(screen.queryByRole('button', { name: /Link to/ })).not.toBeInTheDocument()
  })
})

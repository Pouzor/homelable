/**
 * The device modal is the only editor for a mount — the rack canvas has no
 * right rail — so everything the old inspector did has to work from here.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { RackDeviceModal } from '../components/RackDeviceModal'
import { useRackStore } from '../store'

const createPending = vi.fn()

vi.mock('sonner', async () => (await import('@/test/mocks')).mockSonner())
vi.mock('@/api/client', () => ({
  racksApi: { load: vi.fn(), inventory: vi.fn(), save: vi.fn() },
  scanApi: { createPending: (...args: unknown[]) => createPending(...args) },
}))

const store = () => useRackStore.getState()

beforeEach(() => {
  vi.clearAllMocks()
  store().loadDemo()
})

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
    fireEvent.change(screen.getByLabelText('Device Inventory entry'), {
      target: { value: unracked.id },
    })
    submit()

    await waitFor(() =>
      expect(store().devices.some((d) => d.deviceId === unracked.id)).toBe(true),
    )
    // The mount is a rack row; the inventory entry itself stays, now flagged.
    expect(store().inventory.find((i) => i.id === unracked.id)!.racked).toBe(true)
    expect(store().deviceEditor).toBeNull()
  })

  it('keeps the preselected entry status instead of saving unknown over it', async () => {
    store().openDeviceEditor()
    const first = store().inventory.find((i) => !i.racked)!
    useRackStore.setState({
      inventory: store().inventory.map((i) =>
        i.id === first.id ? { ...i, status: 'online' as const } : i,
      ),
    })
    render(<RackDeviceModal />)

    // The select preselects the first unracked entry, so submitting straight
    // away is a real path — it used to commit `unknown` over the live status.
    submit()

    await waitFor(() => expect(store().deviceEditor).toBeNull())
    expect(store().devices.find((d) => d.deviceId === first.id)!.status).toBe('online')
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

  it('labels inventory options without repeating the IP', () => {
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
        {
          id: 'inv-named',
          label: 'pve-01',
          type: 'proxmox',
          ip: '192.168.1.10',
          status: 'unknown',
          nodeId: null,
          racked: false,
          suggestedFaceplateId: 'server-2u-bays',
        },
      ],
    })
    render(<RackDeviceModal />)

    // Regression: an IP-labelled entry read "192.168.1.63 · 192.168.1.63".
    expect(screen.getByRole('option', { name: '192.168.1.63 · server' })).toBeInTheDocument()
    expect(
      screen.getByRole('option', { name: 'pve-01 · 192.168.1.10 · proxmox' }),
    ).toBeInTheDocument()
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

  it('keeps the port name field usable next to the type select', () => {
    store().openDeviceEditor('dev-pve1')
    render(<RackDeviceModal />)

    // Regression: both carried `w-full`, so the select ate the row and the name
    // field collapsed into an unlabelled box.
    const port = store().devices.find((d) => d.id === 'dev-pve1')!.ports[0]
    const name = screen.getByLabelText(`Port ${port.label} label`)
    expect(name).toHaveClass('flex-1', 'min-w-0')
    expect(name).not.toHaveClass('w-full')
    expect(name).toHaveAttribute('placeholder', 'Port name')
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
})

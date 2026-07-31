/**
 * The device modal is the only editor for a mount — the rack canvas has no
 * right rail — so everything the old inspector did has to work from here.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
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

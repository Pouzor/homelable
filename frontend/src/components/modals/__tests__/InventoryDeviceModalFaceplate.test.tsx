/**
 * The rack faceplate inside the Device Inventory.
 *
 * The inventory row owns the front panel, so the detail modal draws it and edits
 * it — a device modelled on one rack canvas is modelled everywhere, and does not
 * have to be racked again to have its ports moved.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { InventoryDeviceModal } from '../InventoryDeviceModal'
import type { InventoryEntry } from '@/types'

const mockUpdatePending = vi.fn()

vi.mock('@/api/client', () => ({
  scanApi: {
    updatePending: (...a: unknown[]) => mockUpdatePending(...a),
  },
}))

vi.mock('sonner', async () => (await import('@/test/mocks')).mockSonner())

const PORTS = [
  { id: 'p1', label: 'eth0', type: 'rj45' as const, x: 0.2, y: 0.5 },
  { id: 'p2', label: 'eth1', type: 'rj45' as const, x: 0.6, y: 0.5 },
]

function makeDevice(overrides: Partial<InventoryEntry> = {}): InventoryEntry {
  return {
    id: 'dev-1',
    ip: '192.168.1.100',
    mac: 'aa:bb:cc:dd:ee:ff',
    hostname: 'sw.local',
    os: null,
    services: [],
    suggested_type: 'switch',
    status: 'approved',
    status_live: 'online',
    discovered_at: '2024-01-15T10:30:00Z',
    ...overrides,
  }
}

const modelled = (over: Partial<InventoryEntry> = {}) =>
  makeDevice({
    rack_faceplate_id: 'switch-24',
    rack_u_height: 1,
    rack_col_span: 12,
    rack_color: null,
    rack_ports: PORTS,
    ...over,
  })

const noop = { onClose: vi.fn(), onApprove: vi.fn(), onHide: vi.fn(), onIgnore: vi.fn() }

beforeEach(() => {
  vi.clearAllMocks()
  mockUpdatePending.mockResolvedValue({ data: modelled() })
})

const edit = () => fireEvent.click(screen.getByRole('button', { name: /Edit/ }))

describe('InventoryDeviceModal — rack faceplate', () => {
  it('draws the plate of a device some rack has modelled', () => {
    render(<InventoryDeviceModal {...noop} device={modelled()} />)

    expect(screen.getByText('Rack faceplate')).toBeInTheDocument()
    expect(screen.getByTestId('faceplate-stage')).toBeInTheDocument()
    expect(screen.getByText(/Switch 24 ports.*1U.*2 ports/)).toBeInTheDocument()
  })

  it('shows no faceplate section for a device no rack has modelled', () => {
    render(<InventoryDeviceModal {...noop} device={makeDevice()} />)

    expect(screen.queryByText('Rack faceplate')).toBeNull()
    expect(screen.queryByTestId('faceplate-stage')).toBeNull()
  })

  it('leaves the plate read-only until the modal is in edit mode', () => {
    render(<InventoryDeviceModal {...noop} device={modelled()} />)

    expect(screen.queryByRole('button', { name: 'Position ports' })).toBeNull()
    edit()
    expect(screen.getByRole('button', { name: 'Position ports' })).toBeInTheDocument()
    expect(screen.getByLabelText('Port eth0 label')).toBeInTheDocument()
  })

  it('places a port from the inventory, without racking the device first', () => {
    render(<InventoryDeviceModal {...noop} device={modelled()} />)
    edit()
    fireEvent.click(screen.getByRole('button', { name: 'Position ports' }))

    const handle = screen.getByRole('button', { name: 'Move port eth0' })
    fireEvent.pointerDown(handle)
    // Selected, so the arrows move it wherever focus happens to be.
    fireEvent.keyDown(document.body, { key: 'ArrowRight' })
    // The handle follows the port it moved, so the plate and the data agree.
    expect(Number.parseFloat(handle.style.left)).toBeCloseTo(21)
  })

  it('saves the edited plate back onto the inventory row', async () => {
    render(<InventoryDeviceModal {...noop} device={modelled()} />)
    edit()
    fireEvent.change(screen.getByLabelText('Port eth1 label'), { target: { value: 'uplink' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mockUpdatePending).toHaveBeenCalled())
    const body = mockUpdatePending.mock.calls[0][1]
    expect(body.rack_faceplate_id).toBe('switch-24')
    expect(body.rack_u_height).toBe(1)
    expect(body.rack_ports.map((p: { label: string }) => p.label)).toEqual(['eth0', 'uplink'])
  })

  it('sends no plate for a device that has none, rather than modelling it', async () => {
    mockUpdatePending.mockResolvedValue({ data: makeDevice() })
    render(<InventoryDeviceModal {...noop} device={makeDevice()} />)
    edit()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mockUpdatePending).toHaveBeenCalled())
    expect(mockUpdatePending.mock.calls[0][1]).not.toHaveProperty('rack_faceplate_id')
  })

  it('drops an unsaved plate edit when the edit is cancelled', () => {
    render(<InventoryDeviceModal {...noop} device={modelled()} />)
    edit()
    fireEvent.click(screen.getByLabelText('Remove port eth1'))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.getByText(/2 ports/)).toBeInTheDocument()
  })
})

/**
 * Edit mode of the device detail modal — the write half of "the inventory row
 * owns the device facts".
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

function makeDevice(overrides: Partial<InventoryEntry> = {}): InventoryEntry {
  return {
    id: 'dev-1',
    ip: '192.168.1.100',
    mac: 'aa:bb:cc:dd:ee:ff',
    hostname: 'pve.local',
    os: 'Linux',
    services: [],
    suggested_type: 'server',
    status: 'pending',
    discovered_at: '2024-01-15T10:30:00Z',
    ...overrides,
  }
}

const noop = { onClose: vi.fn(), onApprove: vi.fn(), onHide: vi.fn(), onIgnore: vi.fn() }

beforeEach(() => {
  vi.clearAllMocks()
  mockUpdatePending.mockResolvedValue({ data: makeDevice({ label: 'Saved' }) })
})

describe('InventoryDeviceModal — view mode extras', () => {
  it('shows the curated fields the inventory row now owns', () => {
    render(
      <InventoryDeviceModal
        {...noop}
        device={makeDevice({
          notes: 'garage rack',
          cpu_count: 4,
          ram_gb: 16,
          check_method: 'http',
          check_target: 'http://192.168.1.100',
          properties: [{ key: 'Owner', value: 'me', icon: null, visible: true }],
        })}
      />
    )
    expect(screen.getByText('garage rack')).toBeInTheDocument()
    expect(screen.getByText('http → http://192.168.1.100')).toBeInTheDocument()
    expect(screen.getByText('Owner')).toBeInTheDocument()
    expect(screen.getByText('me')).toBeInTheDocument()
  })

  it('prefers the curated label and type over the discovery guesses', () => {
    render(<InventoryDeviceModal {...noop} device={makeDevice({ label: 'Big NAS', type: 'nas' })} />)
    expect(screen.getAllByText('Big NAS').length).toBeGreaterThan(0)
    expect(screen.getByText('nas')).toBeInTheDocument()
    expect(screen.queryByText('server')).toBeNull()
  })
})

describe('InventoryDeviceModal — edit mode', () => {
  it('switches to the form on Edit and back on Cancel', () => {
    render(<InventoryDeviceModal {...noop} device={makeDevice()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
    // Lifecycle buttons belong to the view; the form has Save / Cancel.
    expect(screen.queryByRole('button', { name: 'Put in current Canvas' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('button', { name: 'Put in current Canvas' })).toBeInTheDocument()
  })

  it('seeds the form from the row, falling back to the discovery type', async () => {
    render(<InventoryDeviceModal {...noop} device={makeDevice({ label: null, type: null })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect((screen.getByDisplayValue('pve.local') as HTMLInputElement).value).toBe('pve.local')
    expect(screen.getByDisplayValue('192.168.1.100')).toBeInTheDocument()

    // The untouched type select adopts `suggested_type` rather than clearing it.
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mockUpdatePending).toHaveBeenCalled())
    expect(mockUpdatePending.mock.calls[0][1].type).toBe('server')
  })

  it('PATCHes the edited fields and reports the saved row', async () => {
    const onSaved = vi.fn()
    render(<InventoryDeviceModal {...noop} onSaved={onSaved} device={makeDevice()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))

    fireEvent.change(screen.getByPlaceholderText('Display name'), { target: { value: 'Big NAS' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mockUpdatePending).toHaveBeenCalled())
    const [id, body] = mockUpdatePending.mock.calls[0]
    expect(id).toBe('dev-1')
    expect(body.label).toBe('Big NAS')
    expect(body.hostname).toBe('pve.local')
    expect(body.properties).toEqual([])
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ label: 'Saved' })))
  })

  it('sends null rather than an empty string for a cleared field', async () => {
    render(<InventoryDeviceModal {...noop} device={makeDevice()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByDisplayValue('192.168.1.100'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mockUpdatePending).toHaveBeenCalled())
    expect(mockUpdatePending.mock.calls[0][1].ip).toBeNull()
  })

  // Hardware moved to the properties; the columns are no longer edited here but
  // must still be sent as numbers, not as the form's strings.
  it('sends the numeric hardware fields as numbers', async () => {
    render(<InventoryDeviceModal {...noop} device={makeDevice({ cpu_count: 2, ram_gb: 8 })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mockUpdatePending).toHaveBeenCalled())
    const body = mockUpdatePending.mock.calls[0][1]
    expect(body.ram_gb).toBe(8)
    expect(body.cpu_count).toBe(2)
  })

  it('edits properties through the shared PropertyList', async () => {
    render(
      <InventoryDeviceModal
        {...noop}
        device={makeDevice({ properties: [{ key: 'Rack', value: 'A1', icon: null, visible: true }] })}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    // The shared editor renders the existing property with its remove control.
    expect(screen.getByText('Rack')).toBeInTheDocument()
    fireEvent.click(screen.getByTitle('Remove property'))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mockUpdatePending).toHaveBeenCalled())
    expect(mockUpdatePending.mock.calls[0][1].properties).toEqual([])
  })

  it('removes a service from the editable list', async () => {
    render(
      <InventoryDeviceModal
        {...noop}
        device={makeDevice({
          services: [
            { port: 80, protocol: 'tcp', service_name: 'HTTP' },
            { port: 443, protocol: 'tcp', service_name: 'HTTPS' },
          ],
        })}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.click(screen.getAllByTitle('Remove service')[0])
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mockUpdatePending).toHaveBeenCalled())
    expect(mockUpdatePending.mock.calls[0][1].services).toEqual([
      { port: 443, protocol: 'tcp', service_name: 'HTTPS' },
    ])
  })

  it('stays in edit mode when the save fails', async () => {
    mockUpdatePending.mockRejectedValueOnce(new Error('boom'))
    render(<InventoryDeviceModal {...noop} device={makeDevice()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mockUpdatePending).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
  })

  it('reseeds the form when pointed at another device', () => {
    const { rerender } = render(<InventoryDeviceModal {...noop} device={makeDevice()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.getByDisplayValue('pve.local')).toBeInTheDocument()

    rerender(<InventoryDeviceModal {...noop} device={makeDevice({ id: 'dev-2', hostname: 'other.local' })} />)
    // Back to the view of the new device, not the previous one's open form.
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
    expect(screen.getAllByText('other.local').length).toBeGreaterThan(0)
  })
})

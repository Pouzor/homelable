/**
 * The detail modal reads as a device sheet: a header that identifies the row at
 * a glance, sections that stay put when they have nothing to show, and copyable
 * technical values.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { InventoryDeviceModal } from '../InventoryDeviceModal'
import type { InventoryEntry } from '@/types'

const mockUpdatePending = vi.fn()

vi.mock('@/api/client', () => ({
  scanApi: { updatePending: (...a: unknown[]) => mockUpdatePending(...a) },
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
  mockUpdatePending.mockResolvedValue({ data: makeDevice() })
})

describe('InventoryDeviceModal — header', () => {
  it('badges every source that observed the device', () => {
    render(
      <InventoryDeviceModal
        {...noop}
        // No `ip`, so the only "IP" on screen is the source badge itself.
        device={makeDevice({ ip: null, discovery_source: 'arp', discovery_sources: ['arp', 'proxmox'] })}
      />
    )
    expect(screen.getByText('IP')).toBeInTheDocument()
    expect(screen.getByText('PROXMOX')).toBeInTheDocument()
  })

  it('shows live reachability, which is not the pending/approved lifecycle', () => {
    render(<InventoryDeviceModal {...noop} device={makeDevice({ status: 'pending', status_live: 'online' })} />)
    expect(screen.getByText('Online')).toBeInTheDocument()
  })

  it('reads unknown when the device has never been checked', () => {
    render(<InventoryDeviceModal {...noop} device={makeDevice()} />)
    expect(screen.getByText('Unknown')).toBeInTheDocument()
  })

  it('counts the canvases drawing the device', () => {
    render(<InventoryDeviceModal {...noop} device={makeDevice({ canvas_count: 3 })} />)
    expect(screen.getByTitle('Drawn on 3 canvases')).toBeInTheDocument()
  })

  it('marks a hidden row', () => {
    render(<InventoryDeviceModal {...noop} device={makeDevice({ status: 'hidden' })} />)
    expect(screen.getByText('Hidden')).toBeInTheDocument()
  })
})

describe('InventoryDeviceModal — view sections', () => {
  // What answers on a host belongs beside how to reach it, not in the curation
  // column next to the properties.
  it('puts the services under Identity', () => {
    render(
      <InventoryDeviceModal
        {...noop}
        device={makeDevice({ services: [{ port: 22, protocol: 'tcp', service_name: 'SSH' }] })}
      />
    )
    const identity = screen.getByTestId('device-column-identity')
    expect(identity).toHaveTextContent('Identity')
    expect(identity).toHaveTextContent('Services found (1)')
    expect(screen.getByTestId('device-column-curation')).not.toHaveTextContent('Services found')
  })

  it('heads every section with an icon', () => {
    render(<InventoryDeviceModal {...noop} device={makeDevice()} />)
    const headings = [...screen.getByRole('dialog').querySelectorAll('section > header > span:first-child')]
    expect(headings.length).toBeGreaterThan(0)
    for (const heading of headings) {
      expect(heading.querySelector('svg')).not.toBeNull()
    }
  })

  it('keeps a section with an empty-state rather than dropping it', () => {
    render(<InventoryDeviceModal {...noop} device={makeDevice()} />)
    expect(screen.getByText('No properties.')).toBeInTheDocument()
    expect(screen.getByText('No notes.')).toBeInTheDocument()
    expect(screen.getByText('Not monitored — pick a check method from Edit.')).toBeInTheDocument()
  })

  // Hardware is curated as properties, like every other spec — the modal has no
  // hardware section on either side.
  it('shows no hardware section — specs live in the properties', () => {
    render(
      <InventoryDeviceModal
        {...noop}
        device={makeDevice({ cpu_count: 4, ram_gb: 8, cpu_model: 'N5105', disk_gb: 500 })}
      />
    )
    expect(screen.queryByText('Hardware')).toBeNull()
    expect(screen.queryByText('4 vCPU · N5105 · 8 GB RAM · 500 GB disk')).toBeNull()
  })

  it('offers no hardware inputs in the form', () => {
    render(<InventoryDeviceModal {...noop} device={makeDevice({ ram_gb: 8, show_hardware: true })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.queryByText('Hardware')).toBeNull()
    expect(screen.queryByText('RAM (GB)')).toBeNull()
    expect(screen.queryByText('Show hardware specs on the node')).toBeNull()
  })

  it('suggests the spec keys so a hardware value is one click from a property', () => {
    render(<InventoryDeviceModal {...noop} device={makeDevice()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.getByTitle('Add a RAM property')).toBeInTheDocument()
    expect(screen.getByTitle('Add a CPU Model property')).toBeInTheDocument()
  })

  // Proxmox and the YAML import still write these columns; an edit here must not
  // wipe what they recorded.
  it('sends the stored hardware values back untouched', async () => {
    render(
      <InventoryDeviceModal
        {...noop}
        device={makeDevice({ cpu_count: 4, cpu_model: 'N5105', ram_gb: 8, disk_gb: 500, show_hardware: true })}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mockUpdatePending).toHaveBeenCalled())
    const body = mockUpdatePending.mock.calls[0][1]
    expect(body).toMatchObject({
      cpu_count: 4,
      cpu_model: 'N5105',
      ram_gb: 8,
      disk_gb: 500,
      show_hardware: true,
    })
  })

  it('shows the response time of the last check', () => {
    render(<InventoryDeviceModal {...noop} device={makeDevice({ check_method: 'ping', response_time_ms: 12 })} />)
    expect(screen.getByText('12 ms')).toBeInTheDocument()
  })

  it('copies a technical value to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    render(<InventoryDeviceModal {...noop} device={makeDevice()} />)

    fireEvent.click(screen.getByLabelText('Copy IP'))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('192.168.1.100'))
  })

  it('offers no copy button on a value that is not an address', () => {
    render(<InventoryDeviceModal {...noop} device={makeDevice()} />)
    expect(screen.queryByLabelText('Copy OS')).toBeNull()
  })
})

describe('InventoryDeviceModal — edit sections', () => {
  it('edits the make-and-model fields the view shows', async () => {
    render(
      <InventoryDeviceModal
        {...noop}
        device={makeDevice({ vendor: 'Dell', friendly_name: 'kitchen', device_subtype: 'router' })}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByDisplayValue('kitchen'), { target: { value: 'garage' } })
    fireEvent.change(screen.getByDisplayValue('router'), { target: { value: 'switch' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mockUpdatePending).toHaveBeenCalled())
    const body = mockUpdatePending.mock.calls[0][1]
    expect(body.friendly_name).toBe('garage')
    expect(body.device_subtype).toBe('switch')
    expect(body.vendor).toBe('Dell')
  })

  it('drops the edits on Cancel rather than keeping them staged', () => {
    render(<InventoryDeviceModal {...noop} device={makeDevice()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByDisplayValue('pve.local'), { target: { value: 'renamed.local' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.getByDisplayValue('pve.local')).toBeInTheDocument()
    expect(screen.queryByDisplayValue('renamed.local')).toBeNull()
  })

  it('hides the lifecycle actions while editing', () => {
    render(<InventoryDeviceModal {...noop} device={makeDevice()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.queryByRole('button', { name: 'Hide' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
    // …and offers no second Edit while the form is open.
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
  })
})

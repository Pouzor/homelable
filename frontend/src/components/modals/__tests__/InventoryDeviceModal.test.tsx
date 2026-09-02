import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { InventoryDeviceModal, type InventoryEntry } from '../InventoryDeviceModal'

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

describe('InventoryDeviceModal', () => {
  // ── Visibility ────────────────────────────────────────────────────────────

  it('renders nothing when device is null', () => {
    const { container } = render(
      <InventoryDeviceModal device={null} onClose={vi.fn()} onApprove={vi.fn()} onHide={vi.fn()} onIgnore={vi.fn()} />
    )
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })

  it('renders dialog when device is provided', () => {
    render(
      <InventoryDeviceModal device={makeDevice()} onClose={vi.fn()} onApprove={vi.fn()} onHide={vi.fn()} onIgnore={vi.fn()} />
    )
    expect(screen.getByRole('dialog')).toBeDefined()
  })

  // ── Device info display ───────────────────────────────────────────────────

  it('shows hostname as title when available', () => {
    render(
      <InventoryDeviceModal device={makeDevice({ hostname: 'myserver.local' })} onClose={vi.fn()} onApprove={vi.fn()} onHide={vi.fn()} onIgnore={vi.fn()} />
    )
    // hostname appears in both title and info row — check at least one match
    expect(screen.getAllByText('myserver.local').length).toBeGreaterThan(0)
  })

  it('falls back to IP as title when hostname is null', () => {
    render(
      <InventoryDeviceModal device={makeDevice({ hostname: null })} onClose={vi.fn()} onApprove={vi.fn()} onHide={vi.fn()} onIgnore={vi.fn()} />
    )
    // IP appears in both title and info row when hostname is absent
    expect(screen.getAllByText('192.168.1.100').length).toBeGreaterThan(0)
  })

  it('shows IP address', () => {
    render(
      <InventoryDeviceModal device={makeDevice()} onClose={vi.fn()} onApprove={vi.fn()} onHide={vi.fn()} onIgnore={vi.fn()} />
    )
    expect(screen.getByText('192.168.1.100')).toBeDefined()
  })

  it('shows MAC address when present', () => {
    render(
      <InventoryDeviceModal device={makeDevice()} onClose={vi.fn()} onApprove={vi.fn()} onHide={vi.fn()} onIgnore={vi.fn()} />
    )
    expect(screen.getByText('aa:bb:cc:dd:ee:ff')).toBeDefined()
  })

  it('shows OS when present', () => {
    render(
      <InventoryDeviceModal device={makeDevice()} onClose={vi.fn()} onApprove={vi.fn()} onHide={vi.fn()} onIgnore={vi.fn()} />
    )
    expect(screen.getByText('Linux')).toBeDefined()
  })

  it('does not show hostname row when hostname is null', () => {
    render(
      <InventoryDeviceModal device={makeDevice({ hostname: null })} onClose={vi.fn()} onApprove={vi.fn()} onHide={vi.fn()} onIgnore={vi.fn()} />
    )
    // "Hostname" label should not appear in the info rows
    expect(screen.queryByText('Hostname')).toBeNull()
  })

  it('shows suggested type when present', () => {
    render(
      <InventoryDeviceModal device={makeDevice({ suggested_type: 'proxmox' })} onClose={vi.fn()} onApprove={vi.fn()} onHide={vi.fn()} onIgnore={vi.fn()} />
    )
    expect(screen.getByText('proxmox')).toBeDefined()
  })

  // ── Services ──────────────────────────────────────────────────────────────

  it('shows "No services detected" when services list is empty', () => {
    render(
      <InventoryDeviceModal device={makeDevice({ services: [] })} onClose={vi.fn()} onApprove={vi.fn()} onHide={vi.fn()} onIgnore={vi.fn()} />
    )
    expect(screen.getByText('No services detected')).toBeDefined()
  })

  it('shows service count and details', () => {
    const device = makeDevice({
      services: [
        { port: 80, protocol: 'tcp', service_name: 'HTTP', category: 'web' },
        { port: 443, protocol: 'tcp', service_name: 'HTTPS', category: 'web' },
      ],
    })
    render(
      <InventoryDeviceModal device={device} onClose={vi.fn()} onApprove={vi.fn()} onHide={vi.fn()} onIgnore={vi.fn()} />
    )
    expect(screen.getByText('Services found (2)')).toBeDefined()
    expect(screen.getByText('HTTP')).toBeDefined()
    expect(screen.getByText('HTTPS')).toBeDefined()
    expect(screen.getByText('80')).toBeDefined()
    expect(screen.getByText('443')).toBeDefined()
  })

  it('shows service category when present', () => {
    const device = makeDevice({
      services: [{ port: 8006, protocol: 'tcp', service_name: 'Proxmox Web', category: 'hypervisor' }],
    })
    render(
      <InventoryDeviceModal device={device} onClose={vi.fn()} onApprove={vi.fn()} onHide={vi.fn()} onIgnore={vi.fn()} />
    )
    expect(screen.getByText('hypervisor')).toBeDefined()
  })

  // ── Actions ───────────────────────────────────────────────────────────────

  it('calls onApprove with the device when Approve is clicked (parent controls close on success)', () => {
    const device = makeDevice()
    const onApprove = vi.fn()
    const onClose = vi.fn()
    render(
      <InventoryDeviceModal device={device} onClose={onClose} onApprove={onApprove} onHide={vi.fn()} onIgnore={vi.fn()} />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Put in current Canvas' }))
    expect(onApprove).toHaveBeenCalledWith(device)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('calls onHide with the device and onClose when Hide is clicked', () => {
    const device = makeDevice()
    const onHide = vi.fn()
    const onClose = vi.fn()
    render(
      <InventoryDeviceModal device={device} onClose={onClose} onApprove={vi.fn()} onHide={onHide} onIgnore={vi.fn()} />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }))
    expect(onHide).toHaveBeenCalledWith(device)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('calls onIgnore with the device and onClose when Delete is clicked', () => {
    const device = makeDevice()
    const onIgnore = vi.fn()
    const onClose = vi.fn()
    render(
      <InventoryDeviceModal device={device} onClose={onClose} onApprove={vi.fn()} onHide={vi.fn()} onIgnore={onIgnore} />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(onIgnore).toHaveBeenCalledWith(device)
    expect(onClose).toHaveBeenCalledOnce()
  })
})

describe('InventoryDeviceModal — rack gear', () => {
  const rackDevice = makeDevice({
    id: 'dev-rack',
    hostname: 'patch-house',
    ip: null,
    discovery_source: 'rack',
    discovery_sources: ['rack'],
  })

  it('offers no Approve button — rack gear never lands on a logical canvas', () => {
    render(
      <InventoryDeviceModal device={rackDevice} onClose={vi.fn()} onApprove={vi.fn()} onHide={vi.fn()} onIgnore={vi.fn()} />
    )
    expect(screen.queryByRole('button', { name: 'Put in current Canvas' })).toBeNull()
    // Hide and Delete still apply: the entry is inventory like any other.
    expect(screen.getByRole('button', { name: 'Hide' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
  })

  it('keeps Approve for a scanned device', () => {
    render(
      <InventoryDeviceModal device={makeDevice()} onClose={vi.fn()} onApprove={vi.fn()} onHide={vi.fn()} onIgnore={vi.fn()} />
    )
    expect(screen.getByRole('button', { name: 'Put in current Canvas' })).toBeInTheDocument()
  })
})

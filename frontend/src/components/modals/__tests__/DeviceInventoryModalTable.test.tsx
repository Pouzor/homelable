import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { DeviceInventoryModal, INVENTORY_VIEW_STORAGE_KEY } from '../DeviceInventoryModal'
import { useCanvasStore } from '@/stores/canvasStore'

vi.mock('@/stores/canvasStore')

const mockPending = vi.fn()
const mockHidden = vi.fn()

vi.mock('@/api/client', () => ({
  scanApi: {
    pending: (...a: unknown[]) => mockPending(...a),
    hidden: (...a: unknown[]) => mockHidden(...a),
    clearPending: vi.fn().mockResolvedValue({}),
    approve: vi.fn(),
    hide: vi.fn(),
    ignore: vi.fn().mockResolvedValue({}),
    bulkApprove: vi.fn(),
    bulkHide: vi.fn(),
    restore: vi.fn(),
    bulkRestore: vi.fn(),
    proxmoxChildren: vi.fn(),
    merge: vi.fn(),
  },
}))

vi.mock('sonner', async () => (await import('@/test/mocks')).mockSonner())

vi.mock('@/components/modals/InventoryDeviceModal', () => ({
  InventoryDeviceModal: ({ device }: { device: { id: string } | null }) =>
    device ? <div data-testid="approval-modal">{device.id}</div> : null,
}))

function device(id: string, hostname: string, ip: string | null, extra: Record<string, unknown> = {}) {
  return {
    id, ip, hostname, mac: null, os: null, services: [],
    suggested_type: 'server', status: 'pending', discovery_source: 'arp',
    discovered_at: '2026-01-01T00:00:00Z',
    ...extra,
  }
}

const DEVICES = [
  device('ip-10', 'bravo', '10.0.0.10', { canvas_count: 2 }),
  device('ip-9', 'charlie', '10.0.0.9', { services: [{ port: 22, protocol: 'tcp', service_name: 'SSH' }] }),
  device('ip-100', 'alpha', '10.0.0.100'),
]

const baseProps = { open: true, onClose: vi.fn() }

const rowIds = () =>
  within(screen.getByTestId('inventory-table'))
    .getAllByRole('row')
    .slice(1)
    .map((r) => r.getAttribute('data-testid'))

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  vi.mocked(useCanvasStore).mockImplementation(((sel?: (s: unknown) => unknown) => {
    const store = { addNode: vi.fn(), scanEventTs: 0, setSelectedNode: vi.fn() }
    return sel ? sel(store) : store
  }) as unknown as typeof useCanvasStore)
  mockPending.mockResolvedValue({ data: DEVICES })
  mockHidden.mockResolvedValue({ data: [] })
})

describe('DeviceInventoryModal — table view', () => {
  it('starts on the card grid', async () => {
    render(<DeviceInventoryModal {...baseProps} />)
    await waitFor(() => expect(screen.getByTestId('pending-card-ip-10')).toBeInTheDocument())
    expect(screen.queryByTestId('inventory-table')).toBeNull()
    expect(screen.getByTitle('Card view')).toHaveAttribute('aria-pressed', 'true')
  })

  it('switches to a table sorted by name, and remembers the choice', async () => {
    render(<DeviceInventoryModal {...baseProps} />)
    await waitFor(() => expect(screen.getByTestId('pending-card-ip-10')).toBeInTheDocument())

    fireEvent.click(screen.getByTitle('Table view (sortable)'))

    expect(screen.queryByTestId('pending-card-ip-10')).toBeNull()
    expect(rowIds()).toEqual(['inventory-row-ip-100', 'inventory-row-ip-10', 'inventory-row-ip-9'])
    expect(localStorage.getItem(INVENTORY_VIEW_STORAGE_KEY)).toBe('table')
  })

  it('goes back to the grid from the table', async () => {
    localStorage.setItem(INVENTORY_VIEW_STORAGE_KEY, 'table')
    render(<DeviceInventoryModal {...baseProps} />)
    await waitFor(() => expect(screen.getByTestId('inventory-table')).toBeInTheDocument())

    fireEvent.click(screen.getByTitle('Card view'))
    expect(screen.queryByTestId('inventory-table')).toBeNull()
    expect(screen.getByTestId('pending-card-ip-9')).toBeInTheDocument()
    expect(localStorage.getItem(INVENTORY_VIEW_STORAGE_KEY)).toBe('grid')
  })

  it('sorts by a column header, numerically for IPs, and flips on a second click', async () => {
    localStorage.setItem(INVENTORY_VIEW_STORAGE_KEY, 'table')
    render(<DeviceInventoryModal {...baseProps} />)
    await waitFor(() => expect(screen.getByTestId('inventory-table')).toBeInTheDocument())

    const ipHeader = screen.getByRole('columnheader', { name: /^IP/ })
    fireEvent.click(within(ipHeader).getByRole('button'))
    expect(ipHeader).toHaveAttribute('aria-sort', 'ascending')
    expect(rowIds()).toEqual(['inventory-row-ip-9', 'inventory-row-ip-10', 'inventory-row-ip-100'])

    fireEvent.click(within(ipHeader).getByRole('button'))
    expect(ipHeader).toHaveAttribute('aria-sort', 'descending')
    expect(rowIds()).toEqual(['inventory-row-ip-100', 'inventory-row-ip-10', 'inventory-row-ip-9'])
  })

  it('shows services, canvas count and placeholders in the row', async () => {
    localStorage.setItem(INVENTORY_VIEW_STORAGE_KEY, 'table')
    render(<DeviceInventoryModal {...baseProps} />)
    await waitFor(() => expect(screen.getByTestId('inventory-table')).toBeInTheDocument())

    expect(within(screen.getByTestId('inventory-row-ip-9')).getByText('SSH')).toBeInTheDocument()
    expect(within(screen.getByTestId('inventory-row-ip-10')).getByTitle('On 2 canvases')).toHaveTextContent('2')
    expect(within(screen.getByTestId('inventory-row-ip-100')).getAllByText('—').length).toBeGreaterThan(0)
  })

  it('opens the device detail when a row is clicked', async () => {
    localStorage.setItem(INVENTORY_VIEW_STORAGE_KEY, 'table')
    render(<DeviceInventoryModal {...baseProps} />)
    await waitFor(() => expect(screen.getByTestId('inventory-row-ip-9')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('inventory-row-ip-9'))
    expect(screen.getByTestId('approval-modal')).toHaveTextContent('ip-9')
  })

  it('opens the device detail with Enter on a focused row', async () => {
    localStorage.setItem(INVENTORY_VIEW_STORAGE_KEY, 'table')
    render(<DeviceInventoryModal {...baseProps} />)
    await waitFor(() => expect(screen.getByTestId('inventory-row-ip-10')).toBeInTheDocument())

    fireEvent.keyDown(screen.getByTestId('inventory-row-ip-10'), { key: 'Enter' })
    expect(screen.getByTestId('approval-modal')).toHaveTextContent('ip-10')
  })

  it('toggles rows in select mode instead of opening them', async () => {
    localStorage.setItem(INVENTORY_VIEW_STORAGE_KEY, 'table')
    render(<DeviceInventoryModal {...baseProps} />)
    await waitFor(() => expect(screen.getByTestId('inventory-table')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Select mode'))
    const row = screen.getByTestId('inventory-row-ip-9')
    fireEvent.click(row)

    expect(row).toHaveAttribute('aria-selected', 'true')
    expect(within(row).getByRole('checkbox')).toBeChecked()
    expect(screen.queryByTestId('approval-modal')).toBeNull()
    expect(screen.getByText('1 selected')).toBeInTheDocument()
  })

  it('hands the device back in picker mode', async () => {
    localStorage.setItem(INVENTORY_VIEW_STORAGE_KEY, 'table')
    const onPick = vi.fn()
    render(<DeviceInventoryModal {...baseProps} onPick={onPick} />)
    await waitFor(() => expect(screen.getByTestId('inventory-row-ip-100')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('inventory-row-ip-100'))
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 'ip-100' }))
    expect(screen.queryByTestId('approval-modal')).toBeNull()
  })
})

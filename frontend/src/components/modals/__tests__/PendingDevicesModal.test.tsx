import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { PendingDevicesModal } from '../PendingDevicesModal'
import { useCanvasStore } from '@/stores/canvasStore'

vi.mock('@/stores/canvasStore')

const mockBulkApprove = vi.fn()
const mockBulkHide = vi.fn()
const mockRestore = vi.fn()
const mockBulkRestore = vi.fn()
const mockApprove = vi.fn()
const mockHide = vi.fn()
const mockPending = vi.fn()
const mockHidden = vi.fn()

vi.mock('@/api/client', () => ({
  scanApi: {
    pending: (...a: unknown[]) => mockPending(...a),
    hidden: (...a: unknown[]) => mockHidden(...a),
    clearPending: vi.fn().mockResolvedValue({}),
    approve: (...a: unknown[]) => mockApprove(...a),
    hide: (...a: unknown[]) => mockHide(...a),
    ignore: vi.fn().mockResolvedValue({}),
    bulkApprove: (...a: unknown[]) => mockBulkApprove(...a),
    bulkHide: (...a: unknown[]) => mockBulkHide(...a),
    restore: (...a: unknown[]) => mockRestore(...a),
    bulkRestore: (...a: unknown[]) => mockBulkRestore(...a),
  },
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

vi.mock('@/components/modals/PendingDeviceModal', () => ({
  PendingDeviceModal: ({ device }: { device: unknown }) =>
    device ? <div data-testid="approval-modal" /> : null,
}))

const DEVICE_IP = {
  id: 'dev-a',
  ip: '192.168.1.10',
  hostname: 'host-a',
  mac: 'aa:bb:cc:dd:ee:01',
  os: null,
  services: [{ port: 80, protocol: 'tcp', service_name: 'http' }],
  suggested_type: 'server',
  status: 'pending',
  discovery_source: 'arp',
  discovered_at: '2026-01-01T00:00:00Z',
}

const DEVICE_ZIGBEE = {
  id: 'dev-b',
  ip: null,
  hostname: null,
  mac: null,
  os: null,
  services: [],
  suggested_type: 'iot',
  status: 'pending',
  discovery_source: 'zigbee',
  ieee_address: '0x00124b001234abcd',
  friendly_name: 'living-room-bulb',
  vendor: 'Philips',
  model: 'Hue White',
  discovered_at: '2026-01-02T00:00:00Z',
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(useCanvasStore).mockReturnValue({
    addNode: vi.fn(),
    scanEventTs: 0,
  } as unknown as ReturnType<typeof useCanvasStore>)
  // setState is used by injectAutoEdges
  ;(useCanvasStore as unknown as { setState: (fn: unknown) => void }).setState = vi.fn()
  mockPending.mockResolvedValue({ data: [DEVICE_IP, DEVICE_ZIGBEE] })
  mockHidden.mockResolvedValue({ data: [] })
  mockApprove.mockResolvedValue({ data: { node_id: 'n1', edges: [], edges_created: 0 } })
  mockHide.mockResolvedValue({ data: {} })
  mockBulkApprove.mockResolvedValue({
    data: { approved: 2, node_ids: ['n1', 'n2'], device_ids: ['dev-a', 'dev-b'], edges: [], edges_created: 0 },
  })
  mockBulkHide.mockResolvedValue({ data: { hidden: 2, skipped: 0 } })
  mockRestore.mockResolvedValue({ data: { restored: true, device_id: 'dev-a' } })
  mockBulkRestore.mockResolvedValue({ data: { restored: 1, skipped: 0 } })
})

const baseProps = {
  open: true,
  onClose: vi.fn(),
}

describe('PendingDevicesModal', () => {
  it('loads and renders pending devices on open', async () => {
    render(<PendingDevicesModal {...baseProps} />)
    await waitFor(() => expect(screen.getByTestId('pending-card-dev-a')).toBeInTheDocument())
    expect(screen.getByText('living-room-bulb')).toBeInTheDocument()
  })

  it('shows source chip ZIGBEE for zigbee device', async () => {
    render(<PendingDevicesModal {...baseProps} />)
    await waitFor(() => expect(screen.getByTestId('pending-card-dev-a')).toBeInTheDocument())
    expect(screen.getByText('ZIGBEE')).toBeInTheDocument()
  })

  it('filters by search query', async () => {
    render(<PendingDevicesModal {...baseProps} />)
    await waitFor(() => expect(screen.getByTestId('pending-card-dev-a')).toBeInTheDocument())
    fireEvent.change(screen.getByPlaceholderText(/Search/), { target: { value: 'living' } })
    expect(screen.queryByTestId('pending-card-dev-a')).not.toBeInTheDocument()
    expect(screen.getByTestId('pending-card-dev-b')).toBeInTheDocument()
  })

  it('filters by source (zigbee only)', async () => {
    render(<PendingDevicesModal {...baseProps} />)
    await waitFor(() => expect(screen.getByTestId('pending-card-dev-a')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Zigbee' }))
    expect(screen.queryByTestId('pending-card-dev-a')).not.toBeInTheDocument()
    expect(screen.getByTestId('pending-card-dev-b')).toBeInTheDocument()
  })

  it('filters by suggested type', async () => {
    render(<PendingDevicesModal {...baseProps} />)
    await waitFor(() => expect(screen.getByTestId('pending-card-dev-a')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Type filter'), { target: { value: 'server' } })
    expect(screen.getByTestId('pending-card-dev-a')).toBeInTheDocument()
    expect(screen.queryByTestId('pending-card-dev-b')).not.toBeInTheDocument()
  })

  it('switches to hidden status loads hidden devices', async () => {
    mockHidden.mockResolvedValue({
      data: [{ ...DEVICE_IP, id: 'h1', hostname: 'hidden-host', status: 'hidden' }],
    })
    render(<PendingDevicesModal {...baseProps} />)
    await waitFor(() => expect(screen.getByTestId('pending-card-dev-a')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Hidden' }))
    await waitFor(() => expect(screen.getByTestId('pending-card-h1')).toBeInTheDocument())
    expect(mockHidden).toHaveBeenCalled()
  })

  it('opens approval modal when card is clicked outside select mode', async () => {
    render(<PendingDevicesModal {...baseProps} />)
    await waitFor(() => expect(screen.getByTestId('pending-card-dev-a')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('pending-card-dev-a'))
    expect(screen.getByTestId('approval-modal')).toBeInTheDocument()
  })

  it('toggles selection in select mode instead of opening approval', async () => {
    render(<PendingDevicesModal {...baseProps} />)
    await waitFor(() => expect(screen.getByTestId('pending-card-dev-a')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Select mode' }))
    fireEvent.click(screen.getByTestId('pending-card-dev-a'))
    expect(screen.queryByTestId('approval-modal')).not.toBeInTheDocument()
    expect(screen.getByText('1 selected')).toBeInTheDocument()
  })

  it('select all visible selects only filtered devices', async () => {
    render(<PendingDevicesModal {...baseProps} />)
    await waitFor(() => expect(screen.getByTestId('pending-card-dev-a')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Select mode' }))
    fireEvent.change(screen.getByPlaceholderText(/Search/), { target: { value: 'host-a' } })
    fireEvent.click(screen.getByRole('button', { name: /Select all visible/ }))
    expect(screen.getByText('1 selected')).toBeInTheDocument()
  })

  it('bulk approve calls API with selected ids', async () => {
    render(<PendingDevicesModal {...baseProps} />)
    await waitFor(() => expect(screen.getByTestId('pending-card-dev-a')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Select mode' }))
    fireEvent.click(screen.getByTestId('pending-card-dev-a'))
    fireEvent.click(screen.getByTestId('pending-card-dev-b'))
    fireEvent.click(screen.getByRole('button', { name: /Approve \(2\)/ }))
    await waitFor(() => expect(mockBulkApprove).toHaveBeenCalledWith(['dev-a', 'dev-b']))
  })

  it('bulk hide calls API with selected ids', async () => {
    render(<PendingDevicesModal {...baseProps} />)
    await waitFor(() => expect(screen.getByTestId('pending-card-dev-a')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Select mode' }))
    fireEvent.click(screen.getByTestId('pending-card-dev-a'))
    fireEvent.click(screen.getByRole('button', { name: /Hide \(1\)/ }))
    await waitFor(() => expect(mockBulkHide).toHaveBeenCalledWith(['dev-a']))
  })

  it('does not load when closed', () => {
    render(<PendingDevicesModal {...baseProps} open={false} />)
    expect(mockPending).not.toHaveBeenCalled()
  })

  it('respects initialStatus=hidden', async () => {
    mockHidden.mockResolvedValue({ data: [{ ...DEVICE_IP, hostname: 'hidden-host', status: 'hidden' }] })
    render(<PendingDevicesModal {...baseProps} initialStatus="hidden" />)
    await waitFor(() => expect(mockHidden).toHaveBeenCalled())
    expect(mockPending).not.toHaveBeenCalled()
  })

  it('clicking a hidden card restores it instead of opening approval', async () => {
    mockHidden.mockResolvedValue({ data: [{ ...DEVICE_IP, status: 'hidden' }] })
    render(<PendingDevicesModal {...baseProps} initialStatus="hidden" />)
    await waitFor(() => expect(screen.getByTestId('pending-card-dev-a')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('pending-card-dev-a'))
    await waitFor(() => expect(mockRestore).toHaveBeenCalledWith('dev-a'))
    expect(screen.queryByTestId('approval-modal')).not.toBeInTheDocument()
  })

  it('bulk restore in hidden mode calls API with selected ids', async () => {
    mockHidden.mockResolvedValue({ data: [{ ...DEVICE_IP, status: 'hidden' }] })
    render(<PendingDevicesModal {...baseProps} initialStatus="hidden" />)
    await waitFor(() => expect(screen.getByTestId('pending-card-dev-a')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Select mode' }))
    fireEvent.click(screen.getByTestId('pending-card-dev-a'))
    fireEvent.click(screen.getByRole('button', { name: /Restore \(1\)/ }))
    await waitFor(() => expect(mockBulkRestore).toHaveBeenCalledWith(['dev-a']))
  })
})

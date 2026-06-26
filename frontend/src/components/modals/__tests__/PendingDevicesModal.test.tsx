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
const mockAddNode = vi.fn()

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

const DEVICE_ZWAVE = {
  id: 'dev-c',
  ip: null,
  hostname: null,
  mac: null,
  os: null,
  services: [],
  suggested_type: 'zwave_router',
  status: 'pending',
  discovery_source: 'zwave',
  ieee_address: 'zwave-0xh-2',
  friendly_name: 'wall-plug',
  vendor: 'Aeotec',
  model: 'ZW100',
  discovered_at: '2026-01-03T00:00:00Z',
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(useCanvasStore).mockReturnValue({
    addNode: mockAddNode,
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

  it('closes via the X button (routes through DialogClose, not a raw onClick)', async () => {
    const onClose = vi.fn()
    render(<PendingDevicesModal open onClose={onClose} />)
    await waitFor(() => expect(screen.getByTestId('pending-card-dev-a')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
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

  it('shows source chip Z-WAVE for zwave device', async () => {
    mockPending.mockResolvedValue({ data: [DEVICE_IP, DEVICE_ZWAVE] })
    render(<PendingDevicesModal {...baseProps} />)
    await waitFor(() => expect(screen.getByTestId('pending-card-dev-c')).toBeInTheDocument())
    expect(screen.getByText('Z-WAVE')).toBeInTheDocument()
  })

  it('filters by source (zwave only)', async () => {
    mockPending.mockResolvedValue({ data: [DEVICE_IP, DEVICE_ZWAVE] })
    render(<PendingDevicesModal {...baseProps} />)
    await waitFor(() => expect(screen.getByTestId('pending-card-dev-a')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Z-Wave' }))
    expect(screen.queryByTestId('pending-card-dev-a')).not.toBeInTheDocument()
    expect(screen.getByTestId('pending-card-dev-c')).toBeInTheDocument()
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
    await waitFor(() => expect(mockBulkApprove).toHaveBeenCalledWith(['dev-a', 'dev-b'], null))
  })

  it('bulk approve carries the scanned MAC onto the canvas node (#168)', async () => {
    render(<PendingDevicesModal {...baseProps} />)
    await waitFor(() => expect(screen.getByTestId('pending-card-dev-a')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Select mode' }))
    fireEvent.click(screen.getByTestId('pending-card-dev-a'))
    fireEvent.click(screen.getByTestId('pending-card-dev-b'))
    fireEvent.click(screen.getByRole('button', { name: /Approve \(2\)/ }))
    await waitFor(() => expect(mockAddNode).toHaveBeenCalledTimes(2))

    // dev-a is an IP device with a MAC → node carries mac + a MAC property row.
    const ipNode = mockAddNode.mock.calls
      .map((c) => c[0])
      .find((n) => n.id === 'n1')
    expect(ipNode.data.mac).toBe('aa:bb:cc:dd:ee:01')
    expect(ipNode.data.properties).toContainEqual({
      key: 'MAC',
      value: 'aa:bb:cc:dd:ee:01',
      icon: null,
      visible: false,
    })

    // dev-b is zigbee with no MAC → no MAC property row.
    const zbNode = mockAddNode.mock.calls
      .map((c) => c[0])
      .find((n) => n.id === 'n2')
    expect(zbNode.data.properties.some((p: { key: string }) => p.key === 'MAC')).toBe(false)
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

  it('Enter confirms approve in pending select mode', async () => {
    render(<PendingDevicesModal {...baseProps} />)
    await waitFor(() => expect(screen.getByTestId('pending-card-dev-a')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Select mode' }))
    fireEvent.click(screen.getByTestId('pending-card-dev-a'))
    fireEvent.keyDown(window, { key: 'Enter' })
    await waitFor(() => expect(mockBulkApprove).toHaveBeenCalledWith(['dev-a'], null))
    expect(mockBulkRestore).not.toHaveBeenCalled()
  })

  it('Enter restores (not approves) in hidden select mode', async () => {
    mockHidden.mockResolvedValue({ data: [{ ...DEVICE_IP, status: 'hidden' }] })
    render(<PendingDevicesModal {...baseProps} initialStatus="hidden" />)
    await waitFor(() => expect(screen.getByTestId('pending-card-dev-a')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Select mode' }))
    fireEvent.click(screen.getByTestId('pending-card-dev-a'))
    fireEvent.keyDown(window, { key: 'Enter' })
    await waitFor(() => expect(mockBulkRestore).toHaveBeenCalledWith(['dev-a']))
    expect(mockBulkApprove).not.toHaveBeenCalled()
  })

  // --- Device Inventory: rename, canvas badge, on-canvas filter ---

  it('titles the pending view "Device Inventory"', async () => {
    render(<PendingDevicesModal {...baseProps} />)
    await waitFor(() => expect(screen.getByTestId('pending-card-dev-a')).toBeInTheDocument())
    expect(screen.getByText('Device Inventory')).toBeInTheDocument()
  })

  it('shows "Hidden Devices" title in hidden mode', async () => {
    mockHidden.mockResolvedValue({ data: [{ ...DEVICE_IP, status: 'hidden' }] })
    render(<PendingDevicesModal {...baseProps} initialStatus="hidden" />)
    await waitFor(() => expect(screen.getByTestId('pending-card-dev-a')).toBeInTheDocument())
    expect(screen.getByText('Hidden Devices')).toBeInTheDocument()
  })

  it('renders a corner canvas-count when canvas_count > 0', async () => {
    mockPending.mockResolvedValue({ data: [{ ...DEVICE_IP, canvas_count: 2 }] })
    render(<PendingDevicesModal {...baseProps} />)
    await waitFor(() => expect(screen.getByTestId('pending-card-dev-a')).toBeInTheDocument())
    const corner = screen.getByLabelText('On 2 canvases')
    expect(corner).toHaveTextContent('2')
  })

  it('uses singular "canvas" for a single canvas', async () => {
    mockPending.mockResolvedValue({ data: [{ ...DEVICE_IP, canvas_count: 1 }] })
    render(<PendingDevicesModal {...baseProps} />)
    await waitFor(() => expect(screen.getByTestId('pending-card-dev-a')).toBeInTheDocument())
    expect(screen.getByLabelText('On 1 canvas')).toHaveTextContent('1')
  })

  it('does not render the canvas-count corner when canvas_count is 0', async () => {
    mockPending.mockResolvedValue({ data: [{ ...DEVICE_IP, canvas_count: 0 }] })
    render(<PendingDevicesModal {...baseProps} />)
    await waitFor(() => expect(screen.getByTestId('pending-card-dev-a')).toBeInTheDocument())
    expect(screen.queryByLabelText(/On \d+ canvas/)).not.toBeInTheDocument()
  })

  it('filters to devices with detected services when "With services" is on', async () => {
    // dev-a has an http service; dev-b (zigbee) has none.
    render(<PendingDevicesModal {...baseProps} />)
    await waitFor(() => expect(screen.getByTestId('pending-card-dev-b')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /With services/ }))
    expect(screen.getByTestId('pending-card-dev-a')).toBeInTheDocument()
    expect(screen.queryByTestId('pending-card-dev-b')).not.toBeInTheDocument()
  })

  it('shows on-canvas devices by default and hides them when toggled off', async () => {
    mockPending.mockResolvedValue({
      data: [DEVICE_IP, { ...DEVICE_ZIGBEE, canvas_count: 1 }],
    })
    render(<PendingDevicesModal {...baseProps} />)
    // Default: both visible (on-canvas shown).
    await waitFor(() => expect(screen.getByTestId('pending-card-dev-b')).toBeInTheDocument())
    expect(screen.getByTestId('pending-card-dev-a')).toBeInTheDocument()
    // Toggle off → the on-canvas device (dev-b) disappears.
    fireEvent.click(screen.getByRole('button', { name: /Hide on-canvas/ }))
    expect(screen.queryByTestId('pending-card-dev-b')).not.toBeInTheDocument()
    expect(screen.getByTestId('pending-card-dev-a')).toBeInTheDocument()
  })
})

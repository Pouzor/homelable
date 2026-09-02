import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { DeviceInventoryModal } from '../DeviceInventoryModal'
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
const mockSetSelectedNode = vi.fn()
const mockProxmoxChildren = vi.fn()

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
    proxmoxChildren: (...a: unknown[]) => mockProxmoxChildren(...a),
  },
}))

vi.mock('sonner', async () => (await import('@/test/mocks')).mockSonner())

vi.mock('@/components/modals/InventoryDeviceModal', () => ({
  InventoryDeviceModal: ({ device, onApprove }: { device: unknown; onApprove: (d: unknown) => void }) =>
    device ? (
      <div data-testid="approval-modal">
        <button data-testid="do-approve" onClick={() => onApprove(device)}>approve</button>
      </div>
    ) : null,
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

const DEVICE_PROXMOX = {
  id: 'dev-d',
  ip: '10.0.0.5',
  hostname: 'web',
  mac: null,
  os: null,
  services: [],
  suggested_type: 'vm',
  status: 'pending',
  discovery_source: 'proxmox',
  ieee_address: 'pve-pve1-101',
  friendly_name: 'web',
  vendor: 'Proxmox VE',
  model: 'QEMU',
  properties: [{ key: 'CPU Cores', value: '2', icon: 'Cpu', visible: false }],
  discovered_at: '2026-01-04T00:00:00Z',
}

const DEVICE_RACK = {
  id: 'dev-rack',
  ip: null,
  hostname: 'patch-house',
  mac: null,
  os: null,
  services: [],
  suggested_type: null,
  status: 'pending',
  discovery_source: 'rack',
  discovery_sources: ['rack'],
  discovered_at: '2026-01-05T00:00:00Z',
}

const DEVICE_VM = {
  id: 'dev-vm',
  ip: '192.168.1.55',
  hostname: 'web-vm',
  mac: null,
  os: null,
  services: [],
  suggested_type: 'vm',
  status: 'pending',
  discovery_source: 'proxmox',
  discovered_at: '2026-01-06T00:00:00Z',
}

beforeEach(() => {
  vi.clearAllMocks()
  // Apply the selector when one is passed (setSelectedNode is read via a
  // selector), else return the whole store (destructured in the component).
  vi.mocked(useCanvasStore).mockImplementation(((sel?: (s: unknown) => unknown) => {
    const store = { addNode: mockAddNode, scanEventTs: 0, setSelectedNode: mockSetSelectedNode }
    return sel ? sel(store) : store
  }) as unknown as typeof useCanvasStore)
  // setState is used by injectAutoEdges
  ;(useCanvasStore as unknown as { setState: (fn: unknown) => void }).setState = vi.fn()
  mockPending.mockResolvedValue({ data: [DEVICE_IP, DEVICE_ZIGBEE] })
  mockHidden.mockResolvedValue({ data: [] })
  mockApprove.mockResolvedValue({ data: { node_id: 'n1', edges: [], edges_created: 0 } })
  mockHide.mockResolvedValue({ data: {} })
  mockProxmoxChildren.mockResolvedValue({ data: [] })
  mockBulkApprove.mockResolvedValue({
    data: { approved: 2, node_ids: ['n1', 'n2'], device_ids: ['dev-a', 'dev-b'], edges: [], edges_created: 0, skipped_devices: [] },
  })
  mockBulkHide.mockResolvedValue({ data: { hidden: 2, skipped: 0 } })
  mockRestore.mockResolvedValue({ data: { restored: true, device_id: 'dev-a' } })
  mockBulkRestore.mockResolvedValue({ data: { restored: 1, skipped: 0 } })
})

const baseProps = {
  open: true,
  onClose: vi.fn(),
}

describe('DeviceInventoryModal', () => {
  it('loads and renders pending devices on open', async () => {
    render(<DeviceInventoryModal {...baseProps} />)
    await waitFor(() => expect(screen.getByTestId('pending-card-dev-a')).toBeInTheDocument())
    expect(screen.getByText('living-room-bulb')).toBeInTheDocument()
  })

  it('closes via the X button (routes through DialogClose, not a raw onClick)', async () => {
    const onClose = vi.fn()
    render(<DeviceInventoryModal open onClose={onClose} />)
    await waitFor(() => expect(screen.getByTestId('pending-card-dev-a')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('shows source chip ZIGBEE for zigbee device', async () => {
    render(<DeviceInventoryModal {...baseProps} />)
    await waitFor(() => expect(screen.getByTestId('pending-card-dev-a')).toBeInTheDocument())
    expect(screen.getByText('ZIGBEE')).toBeInTheDocument()
  })

  it('filters by search query', async () => {
    render(<DeviceInventoryModal {...baseProps} />)
    await waitFor(() => expect(screen.getByTestId('pending-card-dev-a')).toBeInTheDocument())
    fireEvent.change(screen.getByPlaceholderText(/Search/), { target: { value: 'living' } })
    expect(screen.queryByTestId('pending-card-dev-a')).not.toBeInTheDocument()
    expect(screen.getByTestId('pending-card-dev-b')).toBeInTheDocument()
  })

  it('filters by source (zigbee only)', async () => {
    render(<DeviceInventoryModal {...baseProps} />)
    await waitFor(() => expect(screen.getByTestId('pending-card-dev-a')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Zigbee' }))
    expect(screen.queryByTestId('pending-card-dev-a')).not.toBeInTheDocument()
    expect(screen.getByTestId('pending-card-dev-b')).toBeInTheDocument()
  })

  it('shows source chip Z-WAVE for zwave device', async () => {
    mockPending.mockResolvedValue({ data: [DEVICE_IP, DEVICE_ZWAVE] })
    render(<DeviceInventoryModal {...baseProps} />)
    await waitFor(() => expect(screen.getByTestId('pending-card-dev-c')).toBeInTheDocument())
    expect(screen.getByText('Z-WAVE')).toBeInTheDocument()
  })

  it('colours the role badge with the node-type accent, not flat grey', async () => {
    mockPending.mockResolvedValue({ data: [DEVICE_ZWAVE] })
    render(<DeviceInventoryModal {...baseProps} />)
    const card = await waitFor(() => screen.getByTestId('pending-card-dev-c'))
    // zwave_router accent from the default theme = #e3b341 (amber), applied to
    // both the text colour and a translucent background.
    const badge = within(card).getByText('zwave_router')
    // #e3b341 → rgb(227, 179, 65) once jsdom normalises the inline colour.
    expect(badge).toHaveStyle({ color: 'rgb(227, 179, 65)' })
    expect(badge.className).not.toContain('text-muted-foreground')
  })

  it('filters by source (zwave only)', async () => {
    mockPending.mockResolvedValue({ data: [DEVICE_IP, DEVICE_ZWAVE] })
    render(<DeviceInventoryModal {...baseProps} />)
    await waitFor(() => expect(screen.getByTestId('pending-card-dev-a')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Z-Wave' }))
    expect(screen.queryByTestId('pending-card-dev-a')).not.toBeInTheDocument()
    expect(screen.getByTestId('pending-card-dev-c')).toBeInTheDocument()
  })

  it('shows source chip PROXMOX for a proxmox device (not zigbee despite ieee)', async () => {
    mockPending.mockResolvedValue({ data: [DEVICE_PROXMOX] })
    render(<DeviceInventoryModal {...baseProps} />)
    await waitFor(() => expect(screen.getByTestId('pending-card-dev-d')).toBeInTheDocument())
    expect(screen.getByText('PROXMOX')).toBeInTheDocument()
    expect(screen.queryByText('ZIGBEE')).not.toBeInTheDocument()
  })

  it('filters by source (proxmox only)', async () => {
    mockPending.mockResolvedValue({ data: [DEVICE_IP, DEVICE_PROXMOX] })
    render(<DeviceInventoryModal {...baseProps} />)
    await waitFor(() => expect(screen.getByTestId('pending-card-dev-a')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Proxmox' }))
    expect(screen.queryByTestId('pending-card-dev-a')).not.toBeInTheDocument()
    expect(screen.getByTestId('pending-card-dev-d')).toBeInTheDocument()
  })

  it('filters by suggested type', async () => {
    render(<DeviceInventoryModal {...baseProps} />)
    await waitFor(() => expect(screen.getByTestId('pending-card-dev-a')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Type filter'), { target: { value: 'server' } })
    expect(screen.getByTestId('pending-card-dev-a')).toBeInTheDocument()
    expect(screen.queryByTestId('pending-card-dev-b')).not.toBeInTheDocument()
  })

  it('switches to hidden status loads hidden devices', async () => {
    mockHidden.mockResolvedValue({
      data: [{ ...DEVICE_IP, id: 'h1', hostname: 'hidden-host', status: 'hidden' }],
    })
    render(<DeviceInventoryModal {...baseProps} />)
    await waitFor(() => expect(screen.getByTestId('pending-card-dev-a')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Hidden' }))
    await waitFor(() => expect(screen.getByTestId('pending-card-h1')).toBeInTheDocument())
    expect(mockHidden).toHaveBeenCalled()
  })

  it('opens approval modal when card is clicked outside select mode', async () => {
    render(<DeviceInventoryModal {...baseProps} />)
    await waitFor(() => expect(screen.getByTestId('pending-card-dev-a')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('pending-card-dev-a'))
    expect(screen.getByTestId('approval-modal')).toBeInTheDocument()
  })

  const DUP_409 = {
    response: {
      status: 409,
      data: {
        detail: {
          duplicate: true,
          existing_node_id: 'n-existing',
          existing_label: 'Existing Srv',
          match: 'ip',
          value: '192.168.1.10',
        },
      },
    },
  }

  it('single approve prompts instead of failing when the host is already on the design', async () => {
    mockApprove.mockRejectedValueOnce(DUP_409)
    render(<DeviceInventoryModal {...baseProps} />)
    await waitFor(() => expect(screen.getByTestId('pending-card-dev-a')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('pending-card-dev-a'))
    fireEvent.click(screen.getByTestId('do-approve'))
    // The duplicate dialog appears (not a silent failure).
    await waitFor(() => expect(screen.getByText('Device already on this canvas')).toBeInTheDocument())
    expect(screen.getByText('Existing Srv')).toBeInTheDocument()
    // Regression: the device-detail modal must close so it doesn't trap focus
    // and hide the prompt (two stacked Base UI dialogs).
    expect(screen.queryByTestId('approval-modal')).not.toBeInTheDocument()
  })

  it('"Add duplicate anyway" retries the approve with force=true', async () => {
    mockApprove.mockRejectedValueOnce(DUP_409)
    render(<DeviceInventoryModal {...baseProps} />)
    await waitFor(() => expect(screen.getByTestId('pending-card-dev-a')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('pending-card-dev-a'))
    fireEvent.click(screen.getByTestId('do-approve'))
    await waitFor(() => expect(screen.getByText('Device already on this canvas')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /Add duplicate anyway/ }))
    await waitFor(() => expect(mockApprove).toHaveBeenCalledTimes(2))
    expect(mockApprove).toHaveBeenLastCalledWith('dev-a', expect.objectContaining({ force: true }))
  })

  it('"Go to existing node" selects the existing node and closes the modal', async () => {
    mockApprove.mockRejectedValueOnce(DUP_409)
    const onClose = vi.fn()
    render(<DeviceInventoryModal {...baseProps} onClose={onClose} />)
    await waitFor(() => expect(screen.getByTestId('pending-card-dev-a')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('pending-card-dev-a'))
    fireEvent.click(screen.getByTestId('do-approve'))
    await waitFor(() => expect(screen.getByText('Device already on this canvas')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /Go to existing node/ }))
    expect(mockSetSelectedNode).toHaveBeenCalledWith('n-existing')
    expect(onClose).toHaveBeenCalled()
  })

  it('toggles selection in select mode instead of opening approval', async () => {
    render(<DeviceInventoryModal {...baseProps} />)
    await waitFor(() => expect(screen.getByTestId('pending-card-dev-a')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Select mode' }))
    fireEvent.click(screen.getByTestId('pending-card-dev-a'))
    expect(screen.queryByTestId('approval-modal')).not.toBeInTheDocument()
    expect(screen.getByText('1 selected')).toBeInTheDocument()
  })

  it('select all visible selects only filtered devices', async () => {
    render(<DeviceInventoryModal {...baseProps} />)
    await waitFor(() => expect(screen.getByTestId('pending-card-dev-a')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Select mode' }))
    fireEvent.change(screen.getByPlaceholderText(/Search/), { target: { value: 'host-a' } })
    fireEvent.click(screen.getByRole('button', { name: /Select all visible/ }))
    expect(screen.getByText('1 selected')).toBeInTheDocument()
  })

  it('bulk approve calls API with selected ids', async () => {
    render(<DeviceInventoryModal {...baseProps} />)
    await waitFor(() => expect(screen.getByTestId('pending-card-dev-a')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Select mode' }))
    fireEvent.click(screen.getByTestId('pending-card-dev-a'))
    fireEvent.click(screen.getByTestId('pending-card-dev-b'))
    fireEvent.click(screen.getByRole('button', { name: /Approve \(2\)/ }))
    await waitFor(() => expect(mockBulkApprove).toHaveBeenCalledWith(['dev-a', 'dev-b'], null))
  })

  it('bulk approve reports devices skipped as duplicates', async () => {
    const { toast } = await import('sonner')
    mockBulkApprove.mockResolvedValue({
      data: {
        approved: 1, node_ids: ['n1'], device_ids: ['dev-b'], edges: [], edges_created: 0,
        skipped: 1,
        skipped_devices: [{ device_id: 'dev-a', label: 'host-a', match: 'ip', value: '192.168.1.10', existing_node_id: 'n-existing' }],
      },
    })
    render(<DeviceInventoryModal {...baseProps} />)
    await waitFor(() => expect(screen.getByTestId('pending-card-dev-a')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Select mode' }))
    fireEvent.click(screen.getByTestId('pending-card-dev-a'))
    fireEvent.click(screen.getByTestId('pending-card-dev-b'))
    fireEvent.click(screen.getByRole('button', { name: /Approve \(2\)/ }))
    await waitFor(() =>
      expect(toast.info).toHaveBeenCalledWith(
        expect.stringContaining('1 already on this canvas'),
        expect.anything(),
      ),
    )
  })

  it('keeps approved devices listed after bulk approve (reloads, not strips)', async () => {
    // After approve, pending() still returns the rows (now on-canvas w/ badge).
    mockPending
      .mockResolvedValueOnce({ data: [DEVICE_IP, DEVICE_ZIGBEE] })
      .mockResolvedValue({ data: [
        { ...DEVICE_IP, canvas_count: 1 },
        { ...DEVICE_ZIGBEE, canvas_count: 1 },
      ] })
    render(<DeviceInventoryModal {...baseProps} />)
    await waitFor(() => expect(screen.getByTestId('pending-card-dev-a')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Select mode' }))
    fireEvent.click(screen.getByTestId('pending-card-dev-a'))
    fireEvent.click(screen.getByTestId('pending-card-dev-b'))
    fireEvent.click(screen.getByRole('button', { name: /Approve \(2\)/ }))
    await waitFor(() => expect(mockBulkApprove).toHaveBeenCalled())
    // Reloaded, so rows remain visible instead of the list going empty.
    await waitFor(() => expect(mockPending).toHaveBeenCalledTimes(2))
    expect(screen.getByTestId('pending-card-dev-a')).toBeInTheDocument()
    expect(screen.getByTestId('pending-card-dev-b')).toBeInTheDocument()
  })

  it('bulk approve carries the scanned MAC onto the canvas node (#168)', async () => {
    render(<DeviceInventoryModal {...baseProps} />)
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
    render(<DeviceInventoryModal {...baseProps} />)
    await waitFor(() => expect(screen.getByTestId('pending-card-dev-a')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Select mode' }))
    fireEvent.click(screen.getByTestId('pending-card-dev-a'))
    fireEvent.click(screen.getByRole('button', { name: /Hide \(1\)/ }))
    await waitFor(() => expect(mockBulkHide).toHaveBeenCalledWith(['dev-a']))
  })

  it('does not load when closed', () => {
    render(<DeviceInventoryModal {...baseProps} open={false} />)
    expect(mockPending).not.toHaveBeenCalled()
  })

  it('respects initialStatus=hidden', async () => {
    mockHidden.mockResolvedValue({ data: [{ ...DEVICE_IP, hostname: 'hidden-host', status: 'hidden' }] })
    render(<DeviceInventoryModal {...baseProps} initialStatus="hidden" />)
    await waitFor(() => expect(mockHidden).toHaveBeenCalled())
    expect(mockPending).not.toHaveBeenCalled()
  })

  it('clicking a hidden card restores it instead of opening approval', async () => {
    mockHidden.mockResolvedValue({ data: [{ ...DEVICE_IP, status: 'hidden' }] })
    render(<DeviceInventoryModal {...baseProps} initialStatus="hidden" />)
    await waitFor(() => expect(screen.getByTestId('pending-card-dev-a')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('pending-card-dev-a'))
    await waitFor(() => expect(mockRestore).toHaveBeenCalledWith('dev-a'))
    expect(screen.queryByTestId('approval-modal')).not.toBeInTheDocument()
  })

  it('bulk restore in hidden mode calls API with selected ids', async () => {
    mockHidden.mockResolvedValue({ data: [{ ...DEVICE_IP, status: 'hidden' }] })
    render(<DeviceInventoryModal {...baseProps} initialStatus="hidden" />)
    await waitFor(() => expect(screen.getByTestId('pending-card-dev-a')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Select mode' }))
    fireEvent.click(screen.getByTestId('pending-card-dev-a'))
    fireEvent.click(screen.getByRole('button', { name: /Restore \(1\)/ }))
    await waitFor(() => expect(mockBulkRestore).toHaveBeenCalledWith(['dev-a']))
  })

  it('Enter confirms approve in pending select mode', async () => {
    render(<DeviceInventoryModal {...baseProps} />)
    await waitFor(() => expect(screen.getByTestId('pending-card-dev-a')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Select mode' }))
    fireEvent.click(screen.getByTestId('pending-card-dev-a'))
    fireEvent.keyDown(window, { key: 'Enter' })
    await waitFor(() => expect(mockBulkApprove).toHaveBeenCalledWith(['dev-a'], null))
    expect(mockBulkRestore).not.toHaveBeenCalled()
  })

  it('Enter restores (not approves) in hidden select mode', async () => {
    mockHidden.mockResolvedValue({ data: [{ ...DEVICE_IP, status: 'hidden' }] })
    render(<DeviceInventoryModal {...baseProps} initialStatus="hidden" />)
    await waitFor(() => expect(screen.getByTestId('pending-card-dev-a')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Select mode' }))
    fireEvent.click(screen.getByTestId('pending-card-dev-a'))
    fireEvent.keyDown(window, { key: 'Enter' })
    await waitFor(() => expect(mockBulkRestore).toHaveBeenCalledWith(['dev-a']))
    expect(mockBulkApprove).not.toHaveBeenCalled()
  })

  // --- Device Inventory: rename, canvas badge, on-canvas filter ---

  it('titles the pending view "Device Inventory"', async () => {
    render(<DeviceInventoryModal {...baseProps} />)
    await waitFor(() => expect(screen.getByTestId('pending-card-dev-a')).toBeInTheDocument())
    expect(screen.getByText('Device Inventory')).toBeInTheDocument()
  })

  it('shows "Hidden Devices" title in hidden mode', async () => {
    mockHidden.mockResolvedValue({ data: [{ ...DEVICE_IP, status: 'hidden' }] })
    render(<DeviceInventoryModal {...baseProps} initialStatus="hidden" />)
    await waitFor(() => expect(screen.getByTestId('pending-card-dev-a')).toBeInTheDocument())
    expect(screen.getByText('Hidden Devices')).toBeInTheDocument()
  })

  it('renders a corner canvas-count when canvas_count > 0', async () => {
    mockPending.mockResolvedValue({ data: [{ ...DEVICE_IP, canvas_count: 2 }] })
    render(<DeviceInventoryModal {...baseProps} />)
    await waitFor(() => expect(screen.getByTestId('pending-card-dev-a')).toBeInTheDocument())
    const corner = screen.getByLabelText('On 2 canvases')
    expect(corner).toHaveTextContent('2')
  })

  it('uses singular "canvas" for a single canvas', async () => {
    mockPending.mockResolvedValue({ data: [{ ...DEVICE_IP, canvas_count: 1 }] })
    render(<DeviceInventoryModal {...baseProps} />)
    await waitFor(() => expect(screen.getByTestId('pending-card-dev-a')).toBeInTheDocument())
    expect(screen.getByLabelText('On 1 canvas')).toHaveTextContent('1')
  })

  it('does not render the canvas-count corner when canvas_count is 0', async () => {
    mockPending.mockResolvedValue({ data: [{ ...DEVICE_IP, canvas_count: 0 }] })
    render(<DeviceInventoryModal {...baseProps} />)
    await waitFor(() => expect(screen.getByTestId('pending-card-dev-a')).toBeInTheDocument())
    expect(screen.queryByLabelText(/On \d+ canvas/)).not.toBeInTheDocument()
  })

  it('filters to devices with detected services when "With services" is on', async () => {
    // dev-a has an http service; dev-b (zigbee) has none.
    render(<DeviceInventoryModal {...baseProps} />)
    await waitFor(() => expect(screen.getByTestId('pending-card-dev-b')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /With services/ }))
    expect(screen.getByTestId('pending-card-dev-a')).toBeInTheDocument()
    expect(screen.queryByTestId('pending-card-dev-b')).not.toBeInTheDocument()
  })

  it('shows on-canvas devices by default and hides them when toggled off', async () => {
    mockPending.mockResolvedValue({
      data: [DEVICE_IP, { ...DEVICE_ZIGBEE, canvas_count: 1 }],
    })
    render(<DeviceInventoryModal {...baseProps} />)
    // Default: both visible (on-canvas shown).
    await waitFor(() => expect(screen.getByTestId('pending-card-dev-b')).toBeInTheDocument())
    expect(screen.getByTestId('pending-card-dev-a')).toBeInTheDocument()
    // Toggle off → the on-canvas device (dev-b) disappears.
    fireEvent.click(screen.getByRole('button', { name: /Hide on-canvas/ }))
    expect(screen.queryByTestId('pending-card-dev-b')).not.toBeInTheDocument()
    expect(screen.getByTestId('pending-card-dev-a')).toBeInTheDocument()
  })

  describe('tile timestamps', () => {
    it('shows the linked node lifecycle timestamps for on-canvas devices', async () => {
      mockPending.mockResolvedValue({
        data: [{
          ...DEVICE_IP,
          canvas_count: 1,
          node_created_at: '2026-01-02T10:00:00Z',
          node_last_scan: '2026-06-01T08:30:00Z',
          node_last_modified: '2026-06-20T12:00:00Z',
          node_last_seen: '2026-06-25T09:15:00Z',
        }],
      })
      render(<DeviceInventoryModal {...baseProps} />)
      const card = await screen.findByTestId('pending-card-dev-a')
      const inCard = within(card)
      expect(inCard.getByText('Created')).toBeInTheDocument()
      expect(inCard.getByText('Scan')).toBeInTheDocument()
      expect(inCard.getByText('Modified')).toBeInTheDocument()
      expect(inCard.getByText('Seen')).toBeInTheDocument()
      // Discovered fallback is not shown once node timestamps are present.
      expect(inCard.queryByText('Discovered')).not.toBeInTheDocument()
    })

    it('falls back to Discovered for devices not on any canvas', async () => {
      mockPending.mockResolvedValue({ data: [DEVICE_IP] })
      render(<DeviceInventoryModal {...baseProps} />)
      const card = await screen.findByTestId('pending-card-dev-a')
      const inCard = within(card)
      expect(inCard.getByText('Discovered')).toBeInTheDocument()
      expect(inCard.queryByText('Created')).not.toBeInTheDocument()
    })
  })

  // Gear created from a rack canvas lives in the same inventory (so it gets the
  // search / filter / hide / delete tooling) but describes a mount, not a host.
  describe('rack devices', () => {
    beforeEach(() => {
      mockPending.mockResolvedValue({ data: [DEVICE_IP, DEVICE_RACK] })
    })

    it('filters them into their own section', async () => {
      render(<DeviceInventoryModal {...baseProps} />)
      await waitFor(() => expect(screen.getByTestId('pending-card-dev-a')).toBeInTheDocument())
      fireEvent.click(screen.getByRole('button', { name: 'Rack devices' }))
      expect(screen.getByTestId('pending-card-dev-rack')).toBeInTheDocument()
      expect(screen.queryByTestId('pending-card-dev-a')).not.toBeInTheDocument()
    })

    it('refuses to approve one onto a logical canvas', async () => {
      const { toast } = await import('sonner')
      render(<DeviceInventoryModal {...baseProps} />)
      await waitFor(() => expect(screen.getByTestId('pending-card-dev-rack')).toBeInTheDocument())
      fireEvent.click(screen.getByTestId('pending-card-dev-rack'))
      fireEvent.click(screen.getByTestId('do-approve'))

      await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('rack canvas')))
      expect(mockApprove).not.toHaveBeenCalled()
    })

    it('drops them from a bulk approve and says how many', async () => {
      const { toast } = await import('sonner')
      render(<DeviceInventoryModal {...baseProps} />)
      await waitFor(() => expect(screen.getByTestId('pending-card-dev-a')).toBeInTheDocument())
      fireEvent.click(screen.getByRole('button', { name: 'Select mode' }))
      fireEvent.click(screen.getByTestId('pending-card-dev-a'))
      fireEvent.click(screen.getByTestId('pending-card-dev-rack'))
      fireEvent.click(screen.getByRole('button', { name: /Approve \(2\)/ }))

      await waitFor(() => expect(mockBulkApprove).toHaveBeenCalledWith(['dev-a'], null))
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('1 rack device'))
    })

    it('keeps rack gear in the rackable list — it is hardware', async () => {
      render(<DeviceInventoryModal {...baseProps} initialRackableOnly />)
      await waitFor(() => expect(screen.getByTestId('pending-card-dev-rack')).toBeInTheDocument())
      expect(screen.getByTestId('pending-card-dev-a')).toBeInTheDocument()
    })

    it('approves nothing when the whole selection is rack gear', async () => {
      render(<DeviceInventoryModal {...baseProps} />)
      await waitFor(() => expect(screen.getByTestId('pending-card-dev-rack')).toBeInTheDocument())
      fireEvent.click(screen.getByRole('button', { name: 'Select mode' }))
      fireEvent.click(screen.getByTestId('pending-card-dev-rack'))
      fireEvent.click(screen.getByRole('button', { name: /Approve \(1\)/ }))

      await waitFor(() => expect(mockBulkApprove).not.toHaveBeenCalled())
    })
  })

  // The rack canvas opens this modal to pick a mount, so it needs a hardware
  // filter and a way to hand one device back instead of approving it.
  describe('rackable filter and picker mode', () => {
    beforeEach(() => {
      mockPending.mockResolvedValue({ data: [DEVICE_IP, DEVICE_VM] })
    })

    it('drops virtual and mesh kinds when the filter is on', async () => {
      render(<DeviceInventoryModal {...baseProps} />)
      await waitFor(() => expect(screen.getByTestId('pending-card-dev-vm')).toBeInTheDocument())

      fireEvent.click(screen.getByRole('button', { name: 'Rackable' }))
      expect(screen.getByTestId('pending-card-dev-a')).toBeInTheDocument()
      expect(screen.queryByTestId('pending-card-dev-vm')).not.toBeInTheDocument()
    })

    it('starts filtered when the caller asks for it', async () => {
      render(<DeviceInventoryModal {...baseProps} initialRackableOnly />)
      await waitFor(() => expect(screen.getByTestId('pending-card-dev-a')).toBeInTheDocument())
      expect(screen.queryByTestId('pending-card-dev-vm')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Rackable' })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
    })

    it('re-arms the filter when reopened after the user turned it off', async () => {
      const { rerender } = render(<DeviceInventoryModal {...baseProps} initialRackableOnly />)
      await waitFor(() => expect(screen.getByTestId('pending-card-dev-a')).toBeInTheDocument())
      fireEvent.click(screen.getByRole('button', { name: 'Rackable' }))
      expect(screen.getByTestId('pending-card-dev-vm')).toBeInTheDocument()

      rerender(<DeviceInventoryModal {...baseProps} open={false} initialRackableOnly />)
      rerender(<DeviceInventoryModal {...baseProps} initialRackableOnly />)
      await waitFor(() => expect(screen.getByTestId('pending-card-dev-a')).toBeInTheDocument())
      expect(screen.queryByTestId('pending-card-dev-vm')).not.toBeInTheDocument()
    })

    it('hands the card back instead of opening the approval modal', async () => {
      const onPick = vi.fn()
      render(<DeviceInventoryModal {...baseProps} onPick={onPick} />)
      await waitFor(() => expect(screen.getByTestId('pending-card-dev-a')).toBeInTheDocument())

      fireEvent.click(screen.getByTestId('pending-card-dev-a'))
      expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 'dev-a' }))
      expect(screen.queryByTestId('approval-modal')).not.toBeInTheDocument()
    })

    it('hides the bulk and clear controls a picker has no business offering', async () => {
      render(<DeviceInventoryModal {...baseProps} onPick={vi.fn()} />)
      await waitFor(() => expect(screen.getByTestId('pending-card-dev-a')).toBeInTheDocument())

      expect(screen.queryByRole('button', { name: 'Select mode' })).not.toBeInTheDocument()
      expect(screen.queryByTitle(/Clear all pending/)).not.toBeInTheDocument()
      // …and the keyboard shortcut cannot bring select mode back either.
      fireEvent.keyDown(window, { key: 's' })
      expect(screen.queryByRole('button', { name: /Approve \(/ })).not.toBeInTheDocument()
    })
  })
})

/**
 * A device documented straight on a canvas carries a curated `label` and `type`
 * and no discovery guess at all — the card has to read those, or a printer
 * shows up unnamed with the generic circle.
 */
describe('DeviceInventoryModal — the curated type wins over the discovery guess', () => {
  const DEVICE_CANVAS = {
    id: 'dev-printer',
    ip: '192.168.1.77',
    hostname: null,
    mac: null,
    os: null,
    services: [],
    label: 'Office printer',
    type: 'printer',
    suggested_type: null,
    status: 'approved',
    discovery_source: 'canvas',
    discovery_sources: ['canvas'],
    discovered_at: '2026-02-01T00:00:00Z',
  }

  it('names the card from the curated label', async () => {
    mockPending.mockResolvedValue({ data: [DEVICE_CANVAS] })
    render(<DeviceInventoryModal {...baseProps} />)
    await waitFor(() => expect(screen.getByTestId('pending-card-dev-printer')).toBeInTheDocument())
    expect(screen.getByText('Office printer')).toBeInTheDocument()
  })

  it('badges the curated type', async () => {
    mockPending.mockResolvedValue({ data: [DEVICE_CANVAS] })
    render(<DeviceInventoryModal {...baseProps} />)
    await waitFor(() => expect(screen.getByTestId('pending-card-dev-printer')).toBeInTheDocument())
    expect(within(screen.getByTestId('pending-card-dev-printer')).getByText('printer')).toBeInTheDocument()
  })

  it('prefers it over a stale discovery guess', async () => {
    mockPending.mockResolvedValue({ data: [{ ...DEVICE_CANVAS, suggested_type: 'server' }] })
    render(<DeviceInventoryModal {...baseProps} />)
    await waitFor(() => expect(screen.getByTestId('pending-card-dev-printer')).toBeInTheDocument())
    const card = within(screen.getByTestId('pending-card-dev-printer'))
    expect(card.getByText('printer')).toBeInTheDocument()
    expect(card.queryByText('server')).toBeNull()
  })

  it('filters on it', async () => {
    mockPending.mockResolvedValue({ data: [DEVICE_CANVAS, DEVICE_IP] })
    render(<DeviceInventoryModal {...baseProps} />)
    await waitFor(() => expect(screen.getByTestId('pending-card-dev-printer')).toBeInTheDocument())

    fireEvent.change(screen.getByLabelText('Type filter'), { target: { value: 'printer' } })
    expect(screen.getByTestId('pending-card-dev-printer')).toBeInTheDocument()
    expect(screen.queryByTestId('pending-card-dev-a')).not.toBeInTheDocument()
  })

  it('approves onto a node of that type', async () => {
    mockPending.mockResolvedValue({ data: [DEVICE_CANVAS] })
    render(<DeviceInventoryModal {...baseProps} />)
    await waitFor(() => expect(screen.getByTestId('pending-card-dev-printer')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('pending-card-dev-printer'))
    fireEvent.click(screen.getByTestId('do-approve'))
    await waitFor(() => expect(mockApprove).toHaveBeenCalled())
    expect(mockApprove.mock.calls[0][1]).toMatchObject({ type: 'printer', label: 'Office printer' })
  })
})

// --- Proxmox host: ask about the guests before placing it ---

const PVE_HOST = {
  id: 'dev-pve',
  ip: '10.0.0.1',
  hostname: 'pve1',
  mac: null,
  os: null,
  services: [],
  suggested_type: 'proxmox',
  status: 'pending',
  discovery_source: 'proxmox',
  ieee_address: 'pve-node-pve1',
  friendly_name: 'pve1',
  discovered_at: '2026-01-07T00:00:00Z',
}

const PVE_GUESTS = [
  { ...DEVICE_PROXMOX, id: 'dev-g1', friendly_name: 'web' },
  { ...DEVICE_PROXMOX, id: 'dev-g2', friendly_name: 'dns', suggested_type: 'lxc', ieee_address: 'pve-pve1-102' },
]

async function openProxmoxPrompt() {
  mockPending.mockResolvedValue({ data: [PVE_HOST] })
  mockProxmoxChildren.mockResolvedValue({ data: PVE_GUESTS })
  render(<DeviceInventoryModal {...baseProps} />)
  await waitFor(() => expect(screen.getByTestId('pending-card-dev-pve')).toBeInTheDocument())
  fireEvent.click(screen.getByTestId('pending-card-dev-pve'))
  fireEvent.click(screen.getByTestId('do-approve'))
  await waitFor(() => expect(screen.getByRole('button', { name: /add 3 to canvas/i })).toBeInTheDocument())
}

describe('DeviceInventoryModal — Proxmox host approval', () => {
  beforeEach(() => {
    mockBulkApprove.mockResolvedValue({
      data: {
        approved: 3,
        node_ids: ['n-host', 'n-g1', 'n-g2'],
        device_ids: ['dev-pve', 'dev-g1', 'dev-g2'],
        edges: [], edges_created: 0, skipped: 0, skipped_devices: [],
      },
    })
  })

  it('approves a host with no guests straight away, no prompt', async () => {
    mockPending.mockResolvedValue({ data: [PVE_HOST] })
    mockProxmoxChildren.mockResolvedValue({ data: [] })
    render(<DeviceInventoryModal {...baseProps} />)
    await waitFor(() => expect(screen.getByTestId('pending-card-dev-pve')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('pending-card-dev-pve'))
    fireEvent.click(screen.getByTestId('do-approve'))
    await waitFor(() => expect(mockApprove).toHaveBeenCalled())
    expect(mockBulkApprove).not.toHaveBeenCalled()
  })

  it('asks about the guests when the host has some', async () => {
    await openProxmoxPrompt()
    expect(screen.getByText('web')).toBeInTheDocument()
    expect(screen.getByText('dns')).toBeInTheDocument()
    expect(mockApprove).not.toHaveBeenCalled()
  })

  it('nests the guests in the host in container mode', async () => {
    await openProxmoxPrompt()
    fireEvent.click(screen.getByRole('button', { name: /add 3 to canvas/i }))
    await waitFor(() =>
      expect(mockBulkApprove).toHaveBeenCalledWith(['dev-pve', 'dev-g1', 'dev-g2'], null),
    )
    const added = mockAddNode.mock.calls.map((c) => c[0])
    const hostNode = added.find((n) => n.id === 'n-host')
    expect(hostNode.data.container_mode).toBe(true)
    expect(hostNode.width).toBeGreaterThan(0)
    // The host must be added before its guests — addNode resolves parent_id
    // against what is already in the store.
    expect(added[0].id).toBe('n-host')
    added.filter((n) => n.id !== 'n-host').forEach((n) => {
      expect(n.data.parent_id).toBe('n-host')
    })
  })

  it('leaves the guests unnested in linked mode', async () => {
    await openProxmoxPrompt()
    fireEvent.click(screen.getByRole('radio', { name: /separate nodes linked to the host/i }))
    fireEvent.click(screen.getByRole('button', { name: /add 3 to canvas/i }))
    await waitFor(() => expect(mockBulkApprove).toHaveBeenCalled())
    const added = mockAddNode.mock.calls.map((c) => c[0])
    expect(added.find((n) => n.id === 'n-host').data.container_mode).toBeUndefined()
    added.forEach((n) => expect(n.data.parent_id).toBeUndefined())
  })

  it('falls back to the single approve when the guests are unticked', async () => {
    await openProxmoxPrompt()
    fireEvent.click(screen.getByRole('checkbox', { name: /also add its 2 guests/i }))
    fireEvent.click(screen.getByRole('button', { name: /add 1 to canvas/i }))
    await waitFor(() => expect(mockApprove).toHaveBeenCalled())
    expect(mockBulkApprove).not.toHaveBeenCalled()
  })

  it('places the guests loose when the host itself was skipped as a duplicate', async () => {
    mockBulkApprove.mockResolvedValue({
      data: {
        approved: 2,
        node_ids: ['n-g1', 'n-g2'],
        device_ids: ['dev-g1', 'dev-g2'],
        edges: [], edges_created: 0, skipped: 1,
        skipped_devices: [{ device_id: 'dev-pve', label: 'pve1', match: 'ip', value: '10.0.0.1' }],
      },
    })
    await openProxmoxPrompt()
    fireEvent.click(screen.getByRole('button', { name: /add 3 to canvas/i }))
    await waitFor(() => expect(mockAddNode).toHaveBeenCalled())
    const added = mockAddNode.mock.calls.map((c) => c[0])
    expect(added.map((n) => n.id)).toEqual(['n-g1', 'n-g2'])
    added.forEach((n) => expect(n.data.parent_id).toBeUndefined())
  })

  it('still places the host when the children lookup fails', async () => {
    mockPending.mockResolvedValue({ data: [PVE_HOST] })
    mockProxmoxChildren.mockRejectedValue(new Error('boom'))
    render(<DeviceInventoryModal {...baseProps} />)
    await waitFor(() => expect(screen.getByTestId('pending-card-dev-pve')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('pending-card-dev-pve'))
    fireEvent.click(screen.getByTestId('do-approve'))
    await waitFor(() => expect(mockApprove).toHaveBeenCalled())
  })
})

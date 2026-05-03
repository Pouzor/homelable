import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { Sidebar } from '../Sidebar'
import { useCanvasStore } from '@/stores/canvasStore'
import { useAuthStore } from '@/stores/authStore'
import type { Node } from '@xyflow/react'
import type { NodeData } from '@/types'

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@/stores/canvasStore')
vi.mock('@/stores/authStore')

const mockBulkApprove = vi.fn()
const mockBulkHide = vi.fn()

vi.mock('@/api/client', () => ({
  scanApi: {
    trigger: vi.fn().mockResolvedValue({}),
    pending: vi.fn().mockResolvedValue({ data: [] }),
    hidden: vi.fn().mockResolvedValue({ data: [] }),
    runs: vi.fn().mockResolvedValue({ data: [] }),
    stop: vi.fn().mockResolvedValue({}),
    clearPending: vi.fn().mockResolvedValue({}),
    approve: vi.fn().mockResolvedValue({ data: { approved: true, node_id: 'new-node-1' } }),
    hide: vi.fn().mockResolvedValue({ data: { hidden: true } }),
    ignore: vi.fn().mockResolvedValue({ data: { ignored: true } }),
    bulkApprove: (...args: unknown[]) => mockBulkApprove(...args),
    bulkHide: (...args: unknown[]) => mockBulkHide(...args),
  },
  settingsApi: {
    get: vi.fn().mockResolvedValue({ data: { interval_seconds: 60 } }),
    save: vi.fn().mockResolvedValue({ data: { interval_seconds: 60 } }),
  },
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

vi.mock('@/components/ui/Logo', () => ({
  Logo: ({ showText }: { showText: boolean }) => (
    <div data-testid="logo" data-show-text={showText} />
  ),
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: () => null,
}))

vi.mock('@/components/modals/PendingDeviceModal', () => ({
  PendingDeviceModal: () => null,
}))

// ── Helpers ───────────────────────────────────────────────────────────────────

const makeNode = (id: string, status: NodeData['status'], type: NodeData['type'] = 'server'): Node<NodeData> => ({
  id,
  type,
  position: { x: 0, y: 0 },
  data: { label: id, type, status, services: [] },
})

const mockToggleHideIp = vi.fn()
const mockLogout = vi.fn()

function mockStore(overrides: Partial<ReturnType<typeof useCanvasStore>> = {}) {
  vi.mocked(useCanvasStore).mockReturnValue({
    nodes: [],
    hasUnsavedChanges: false,
    hideIp: false,
    toggleHideIp: mockToggleHideIp,
    addNode: vi.fn(),
    scanEventTs: 0,
    ...overrides,
  } as ReturnType<typeof useCanvasStore>)
}

function mockAuth() {
  vi.mocked(useAuthStore).mockImplementation((selector: (s: { logout: () => void }) => unknown) =>
    selector({ logout: mockLogout }) as ReturnType<typeof useAuthStore>
  )
}

const defaultProps = {
  onAddNode: vi.fn(),
  onAddGroupRect: vi.fn(),
  onScan: vi.fn(),
  onSave: vi.fn(),
  onNodeApproved: vi.fn(),
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Sidebar', () => {
  beforeEach(() => {
    mockStore()
    mockAuth()
    vi.clearAllMocks()
  })

  // ── Render ─────────────────────────────────────────────────────────────────

  it('renders logo and nav items', () => {
    render(<Sidebar {...defaultProps} />)
    expect(screen.getByTestId('logo')).toBeInTheDocument()
    expect(screen.getByText('Add Node')).toBeInTheDocument()
    expect(screen.getByText('Save Canvas')).toBeInTheDocument()
    expect(screen.getByText('Scan Network')).toBeInTheDocument()
  })

  it('shows all view nav items', () => {
    render(<Sidebar {...defaultProps} />)
    expect(screen.getByText('Canvas')).toBeInTheDocument()
    expect(screen.getByText('Pending Devices')).toBeInTheDocument()
    expect(screen.getByText('Hidden Devices')).toBeInTheDocument()
    expect(screen.getByText('Scan History')).toBeInTheDocument()
  })

  // ── Stats ──────────────────────────────────────────────────────────────────

  it('displays total / online / offline counts from store', () => {
    mockStore({
      nodes: [
        makeNode('n1', 'online'),
        makeNode('n2', 'online'),
        makeNode('n3', 'offline'),
        makeNode('n4', 'unknown'),
      ],
    })
    render(<Sidebar {...defaultProps} />)
    // Total (excludes groupRect)
    expect(screen.getByText('4')).toBeInTheDocument()
    // Online
    expect(screen.getByText('2')).toBeInTheDocument()
    // Offline
    expect(screen.getByText('1')).toBeInTheDocument()
  })

  it('excludes groupRect nodes from stats', () => {
    mockStore({
      nodes: [
        makeNode('n1', 'unknown'),  // 1 real node, not online/offline
        makeNode('zone', 'unknown', 'groupRect'),
      ],
    })
    render(<Sidebar {...defaultProps} />)
    // Total row shows 1 (groupRect excluded), online/offline both 0
    const totalRow = screen.getByText('Total').closest('div')!
    expect(totalRow).toHaveTextContent('1')
    expect(screen.getAllByText('0')).toHaveLength(2) // online=0, offline=0
  })

  // ── Collapse ───────────────────────────────────────────────────────────────

  it('collapses sidebar on toggle button click', () => {
    render(<Sidebar {...defaultProps} />)
    const aside = screen.getByRole('complementary')
    expect(aside).toHaveStyle({ width: '220px' })

    const toggle = aside.querySelector('button')!
    fireEvent.click(toggle)
    expect(aside).toHaveStyle({ width: '48px' })
  })

  it('hides label text when collapsed', () => {
    render(<Sidebar {...defaultProps} />)
    const aside = screen.getByRole('complementary')
    const toggle = aside.querySelector('button')!
    fireEvent.click(toggle)
    expect(screen.queryByText('Add Node')).not.toBeInTheDocument()
  })

  it('hides stats footer when collapsed', () => {
    render(<Sidebar {...defaultProps} />)
    expect(screen.getByText('Total')).toBeInTheDocument()
    const toggle = screen.getByRole('complementary').querySelector('button')!
    fireEvent.click(toggle)
    expect(screen.queryByText('Total')).not.toBeInTheDocument()
  })

  it('shows logo with showText=false when collapsed', () => {
    render(<Sidebar {...defaultProps} />)
    const logo = screen.getByTestId('logo')
    expect(logo).toHaveAttribute('data-show-text', 'true')
    const toggle = screen.getByRole('complementary').querySelector('button')!
    fireEvent.click(toggle)
    expect(logo).toHaveAttribute('data-show-text', 'false')
  })

  // ── Action callbacks ───────────────────────────────────────────────────────

  it('calls onAddNode when Add Node is clicked', () => {
    render(<Sidebar {...defaultProps} />)
    fireEvent.click(screen.getByText('Add Node'))
    expect(defaultProps.onAddNode).toHaveBeenCalledOnce()
  })

  it('calls onAddGroupRect when Add Zone is clicked', () => {
    render(<Sidebar {...defaultProps} />)
    fireEvent.click(screen.getByText('Add Zone'))
    expect(defaultProps.onAddGroupRect).toHaveBeenCalledOnce()
  })

  it('calls onSave when Save Canvas is clicked', () => {
    render(<Sidebar {...defaultProps} />)
    fireEvent.click(screen.getByText('Save Canvas'))
    expect(defaultProps.onSave).toHaveBeenCalledOnce()
  })

  it('calls toggleHideIp when Hide IPs is clicked', () => {
    render(<Sidebar {...defaultProps} />)
    fireEvent.click(screen.getByText('Hide IPs'))
    expect(mockToggleHideIp).toHaveBeenCalledOnce()
  })

  it('shows Show IPs label when hideIp is true', () => {
    mockStore({ hideIp: true })
    render(<Sidebar {...defaultProps} />)
    expect(screen.getByText('Show IPs')).toBeInTheDocument()
  })

  // ── Unsaved changes badge ──────────────────────────────────────────────────

  it('shows unsaved badge dot on Save Canvas when hasUnsavedChanges', () => {
    mockStore({ hasUnsavedChanges: true })
    render(<Sidebar {...defaultProps} />)
    // The badge is a span sibling of the Save Canvas button icon
    const saveBtn = screen.getByText('Save Canvas').closest('button')!
    const badge = saveBtn.querySelector('span.rounded-full')
    expect(badge).toBeInTheDocument()
  })

  it('does not show unsaved badge when no changes', () => {
    mockStore({ hasUnsavedChanges: false })
    render(<Sidebar {...defaultProps} />)
    const saveBtn = screen.getByText('Save Canvas').closest('button')!
    const badge = saveBtn.querySelector('span.rounded-full')
    expect(badge).not.toBeInTheDocument()
  })

  // ── Scan action ────────────────────────────────────────────────────────────

  it('calls onScan prop when Scan Network is clicked (scan trigger moved to ScanConfigModal)', () => {
    render(<Sidebar {...defaultProps} />)
    fireEvent.click(screen.getByText('Scan Network'))
    expect(defaultProps.onScan).toHaveBeenCalledOnce()
  })

  // ── Navigation ─────────────────────────────────────────────────────────────

  it('shows Pending panel when Pending Devices nav item is clicked', async () => {
    render(<Sidebar {...defaultProps} />)
    fireEvent.click(screen.getByText('Pending Devices'))
    await waitFor(() => expect(screen.getByText('No pending devices')).toBeInTheDocument())
  })

  it('shows Hidden panel when Hidden Devices nav item is clicked', async () => {
    render(<Sidebar {...defaultProps} />)
    fireEvent.click(screen.getByText('Hidden Devices'))
    await waitFor(() => expect(screen.getByText('No hidden devices')).toBeInTheDocument())
  })

  it('shows History panel when Scan History nav item is clicked', async () => {
    render(<Sidebar {...defaultProps} />)
    fireEvent.click(screen.getByText('Scan History'))
    await waitFor(() => expect(screen.getByText('No scans yet')).toBeInTheDocument())
  })

  // Regression: forceView used to override local state on every render, freezing
  // the sidebar on whichever view the parent forced (e.g. 'history' after a scan).
  it('allows switching views after forceView is set by parent', async () => {
    const { rerender } = render(<Sidebar {...defaultProps} forceView="history" />)
    await waitFor(() => expect(screen.getByText('No scans yet')).toBeInTheDocument())
    // Parent keeps forceView as 'history'; user clicks another nav item.
    rerender(<Sidebar {...defaultProps} forceView="history" />)
    fireEvent.click(screen.getByText('Pending Devices'))
    await waitFor(() => expect(screen.getByText('No pending devices')).toBeInTheDocument())
    expect(screen.queryByText('No scans yet')).not.toBeInTheDocument()
  })

  it('toggles Settings panel on Settings click', async () => {
    render(<Sidebar {...defaultProps} />)
    fireEvent.click(screen.getByText('Settings'))
    await waitFor(() =>
      expect(screen.getByText('Status check interval (s)')).toBeInTheDocument(),
    )
    // Click the nav button again to close (use role to avoid matching the panel heading)
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(screen.queryByText('Status check interval (s)')).not.toBeInTheDocument()
  })

  // ── Logout ─────────────────────────────────────────────────────────────────

  it('shows Logout button in normal mode', () => {
    render(<Sidebar {...defaultProps} />)
    expect(screen.getByText('Logout')).toBeInTheDocument()
  })

  it('calls logout when Logout is clicked', () => {
    render(<Sidebar {...defaultProps} />)
    fireEvent.click(screen.getByText('Logout'))
    expect(mockLogout).toHaveBeenCalledOnce()
  })
})

// ── PendingDevicesPanel — bulk select ─────────────────────────────────────────

const DEVICE_A = {
  id: 'dev-a',
  ip: '192.168.1.10',
  hostname: 'host-a',
  mac: null,
  os: null,
  services: [],
  suggested_type: 'generic',
  status: 'pending',
  discovery_source: 'arp',
}

const DEVICE_B = {
  id: 'dev-b',
  ip: '192.168.1.11',
  hostname: 'host-b',
  mac: null,
  os: null,
  services: [],
  suggested_type: 'generic',
  status: 'pending',
  discovery_source: 'arp',
}

describe('PendingDevicesPanel — bulk select', () => {
  beforeEach(() => {
    mockStore()
    mockAuth()
    vi.clearAllMocks()
    mockBulkApprove.mockResolvedValue({
      data: { approved: 2, node_ids: ['n1', 'n2'], device_ids: ['dev-a', 'dev-b'], skipped: 0 },
    })
    mockBulkHide.mockResolvedValue({ data: { hidden: 2, skipped: 0 } })
  })

  async function renderWithDevices() {
    const { scanApi } = await import('@/api/client')
    vi.mocked(scanApi.pending).mockResolvedValue({ data: [DEVICE_A, DEVICE_B] } as never)
    render(<Sidebar {...defaultProps} forceView="pending" />)
    await waitFor(() => expect(screen.getByText('host-a')).toBeInTheDocument())
  }

  it('renders checkboxes for each device', async () => {
    await renderWithDevices()
    const checkboxes = screen.getAllByRole('checkbox')
    // select-all + 2 device checkboxes
    expect(checkboxes.length).toBe(3)
  })

  it('shows bulk action bar when a device is checked', async () => {
    await renderWithDevices()
    const [, firstDeviceCheckbox] = screen.getAllByRole('checkbox')
    fireEvent.click(firstDeviceCheckbox)
    await waitFor(() => expect(screen.getByText(/Approve \(1\)/)).toBeInTheDocument())
    expect(screen.getByText(/Hide \(1\)/)).toBeInTheDocument()
  })

  it('hides bulk action bar when no device is checked', async () => {
    await renderWithDevices()
    expect(screen.queryByText(/Approve \(/)).not.toBeInTheDocument()
  })

  it('select-all checks all devices', async () => {
    await renderWithDevices()
    const [selectAll] = screen.getAllByRole('checkbox')
    fireEvent.click(selectAll)
    await waitFor(() => expect(screen.getByText(/Approve \(2\)/)).toBeInTheDocument())
  })

  it('select-all unchecks all when all are selected', async () => {
    await renderWithDevices()
    const [selectAll] = screen.getAllByRole('checkbox')
    fireEvent.click(selectAll) // select all
    fireEvent.click(selectAll) // deselect all
    await waitFor(() => expect(screen.queryByText(/Approve \(/)).not.toBeInTheDocument())
  })

  it('calls bulkApprove with checked ids and removes devices from list', async () => {
    await renderWithDevices()
    const [selectAll] = screen.getAllByRole('checkbox')
    fireEvent.click(selectAll)
    fireEvent.click(screen.getByText(/Approve \(2\)/))
    await waitFor(() => expect(mockBulkApprove).toHaveBeenCalledWith(['dev-a', 'dev-b']))
    await waitFor(() => expect(screen.queryByText('host-a')).not.toBeInTheDocument())
  })

  it('calls bulkHide with checked ids and removes devices from list', async () => {
    await renderWithDevices()
    const [selectAll] = screen.getAllByRole('checkbox')
    fireEvent.click(selectAll)
    fireEvent.click(screen.getByText(/Hide \(2\)/))
    await waitFor(() => expect(mockBulkHide).toHaveBeenCalledWith(['dev-a', 'dev-b']))
    await waitFor(() => expect(screen.queryByText('host-b')).not.toBeInTheDocument())
  })
})

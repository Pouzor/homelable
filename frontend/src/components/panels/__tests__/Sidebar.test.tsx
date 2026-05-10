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

vi.mock('@/api/client', () => ({
  scanApi: {
    trigger: vi.fn().mockResolvedValue({}),
    runs: vi.fn().mockResolvedValue({ data: [] }),
    stop: vi.fn().mockResolvedValue({}),
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
  onZigbeeImport: vi.fn(),
  onSave: vi.fn(),
  onOpenPending: vi.fn(),
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
    expect(screen.getByText('4')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
  })

  it('excludes groupRect nodes from stats', () => {
    mockStore({
      nodes: [
        makeNode('n1', 'unknown'),
        makeNode('zone', 'unknown', 'groupRect'),
      ],
    })
    render(<Sidebar {...defaultProps} />)
    const totalRow = screen.getByText('Total').closest('div')!
    expect(totalRow).toHaveTextContent('1')
    expect(screen.getAllByText('0')).toHaveLength(2)
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

  it('calls onScan prop when Scan Network is clicked', () => {
    render(<Sidebar {...defaultProps} />)
    fireEvent.click(screen.getByText('Scan Network'))
    expect(defaultProps.onScan).toHaveBeenCalledOnce()
  })

  // ── Pending / Hidden open modal ────────────────────────────────────────────

  it('calls onOpenPending with pending status when Pending Devices is clicked', () => {
    render(<Sidebar {...defaultProps} />)
    fireEvent.click(screen.getByText('Pending Devices'))
    expect(defaultProps.onOpenPending).toHaveBeenCalledWith(undefined, 'pending')
  })

  it('calls onOpenPending with hidden status when Hidden Devices is clicked', () => {
    render(<Sidebar {...defaultProps} />)
    fireEvent.click(screen.getByText('Hidden Devices'))
    expect(defaultProps.onOpenPending).toHaveBeenCalledWith(undefined, 'hidden')
  })

  it('shows History panel when Scan History nav item is clicked', async () => {
    render(<Sidebar {...defaultProps} />)
    fireEvent.click(screen.getByText('Scan History'))
    await waitFor(() => expect(screen.getByText('No scans yet')).toBeInTheDocument())
  })

  // Regression: forceView must not freeze local state across rerenders.
  it('allows switching views after forceView is set by parent', async () => {
    const { rerender } = render(<Sidebar {...defaultProps} forceView="history" />)
    await waitFor(() => expect(screen.getByText('No scans yet')).toBeInTheDocument())
    rerender(<Sidebar {...defaultProps} forceView="history" />)
    fireEvent.click(screen.getByText('Canvas'))
    await waitFor(() => expect(screen.queryByText('No scans yet')).not.toBeInTheDocument())
  })

  it('toggles Settings panel on Settings click', async () => {
    render(<Sidebar {...defaultProps} />)
    fireEvent.click(screen.getByText('Settings'))
    await waitFor(() =>
      expect(screen.getByText('Status check interval (s)')).toBeInTheDocument(),
    )
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

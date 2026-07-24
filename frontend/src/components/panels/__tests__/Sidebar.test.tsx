import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { Sidebar } from '../Sidebar'
import { useCanvasStore } from '@/stores/canvasStore'
import { useAuthStore } from '@/stores/authStore'
import type { Node } from '@xyflow/react'
import type { NodeData, Design } from '@/types'
import * as standaloneStorage from '@/utils/standaloneStorage'

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@/stores/canvasStore')
vi.mock('@/stores/authStore')

vi.mock('@/api/client', () => ({
  authApi: {
    logout: vi.fn().mockResolvedValue({}),
  },
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

vi.mock('sonner', async () => (await import('@/test/mocks')).mockSonner())

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

const mockLogout = vi.fn()

function mockStore(overrides: Partial<ReturnType<typeof useCanvasStore>> = {}) {
  vi.mocked(useCanvasStore).mockReturnValue({
    nodes: [],
    hasUnsavedChanges: false,
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
  onAddText: vi.fn(),
  onScan: vi.fn(),
  onZigbeeImport: vi.fn(),
  onZwaveImport: vi.fn(),
  onSave: vi.fn(),
  onOpenSettings: vi.fn(),
  onOpenHistory: vi.fn(),
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
    expect(screen.getByText('Device Inventory')).toBeInTheDocument()
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

  it('calls onZwaveImport when Z-Wave Import is clicked', () => {
    render(<Sidebar {...defaultProps} />)
    fireEvent.click(screen.getByText('Z-Wave Import'))
    expect(defaultProps.onZwaveImport).toHaveBeenCalledOnce()
  })

  it('calls onSave when Save Canvas is clicked', () => {
    render(<Sidebar {...defaultProps} />)
    fireEvent.click(screen.getByText('Save Canvas'))
    expect(defaultProps.onSave).toHaveBeenCalledOnce()
  })

  // Regression (#186): the click handler must not forward the MouseEvent as an
  // argument — handleSave treats its first arg as a designIdOverride, so leaking
  // the event corrupts design_id and the save silently fails.
  it('calls onSave with no arguments (does not leak the click event)', () => {
    render(<Sidebar {...defaultProps} />)
    fireEvent.click(screen.getByText('Save Canvas'))
    expect(defaultProps.onSave).toHaveBeenCalledWith()
  })

  it('calls onOpenSettings when Settings is clicked', () => {
    render(<Sidebar {...defaultProps} />)
    fireEvent.click(screen.getByText('Settings'))
    expect(defaultProps.onOpenSettings).toHaveBeenCalledOnce()
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

  it('calls onOpenPending with pending status when Device Inventory is clicked', () => {
    render(<Sidebar {...defaultProps} />)
    fireEvent.click(screen.getByText('Device Inventory'))
    expect(defaultProps.onOpenPending).toHaveBeenCalledWith(undefined, 'pending')
  })

  it('calls onOpenPending with hidden status when Hidden Devices is clicked', () => {
    render(<Sidebar {...defaultProps} />)
    fireEvent.click(screen.getByText('Hidden Devices'))
    expect(defaultProps.onOpenPending).toHaveBeenCalledWith(undefined, 'hidden')
  })

  it('calls onOpenHistory when Scan History nav item is clicked', () => {
    render(<Sidebar {...defaultProps} />)
    fireEvent.click(screen.getByText('Scan History'))
    expect(defaultProps.onOpenHistory).toHaveBeenCalledOnce()
  })

  it('calls onOpenSettings when Settings is clicked', () => {
    render(<Sidebar {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(defaultProps.onOpenSettings).toHaveBeenCalledOnce()
  })

  // ── Logout ─────────────────────────────────────────────────────────────────

  it('shows Logout button in normal mode', () => {
    render(<Sidebar {...defaultProps} />)
    expect(screen.getByText('Logout')).toBeInTheDocument()
  })

  it('ends the backend session before clearing local auth state', async () => {
    const { authApi } = await import('@/api/client')
    render(<Sidebar {...defaultProps} />)
    fireEvent.click(screen.getByText('Logout'))
    await waitFor(() => {
      expect(authApi.logout).toHaveBeenCalledOnce()
      expect(mockLogout).toHaveBeenCalledOnce()
    })
  })
})

// ── Standalone mode ────────────────────────────────────────────────────────────
// VITE_STANDALONE is read at module load, so re-import Sidebar after stubbing it.
// The hoisted vi.mock auto-mocks re-apply on re-import; configure the fresh mock
// instances after the dynamic import.
describe('Sidebar (standalone)', () => {
  const makeDesign = (id: string, name: string): Design => ({
    id, name, design_type: 'network', icon: null,
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  })

  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  // Re-import Sidebar after stubbing VITE_STANDALONE. Returns the design-store
  // instance the re-imported Sidebar uses, seeded with `designs` so we can drive
  // and assert the switcher.
  async function renderStandalone(nodes: Node<NodeData>[] = [], designs: Design[] = []) {
    vi.stubEnv('VITE_STANDALONE', 'true')
    vi.resetModules()
    const { useCanvasStore: cs } = await import('@/stores/canvasStore')
    const { useAuthStore: as } = await import('@/stores/authStore')
    const { useDesignStore: ds } = await import('@/stores/designStore')
    vi.mocked(cs).mockReturnValue({
      nodes, hasUnsavedChanges: false, addNode: vi.fn(), scanEventTs: 0,
    } as ReturnType<typeof useCanvasStore>)
    vi.mocked(as).mockImplementation((selector: (s: { logout: () => void }) => unknown) =>
      selector({ logout: mockLogout }) as ReturnType<typeof useAuthStore>
    )
    ds.setState({ designs, activeDesignId: designs[0]?.id ?? null, loaded: true })
    const { Sidebar: SB } = await import('../Sidebar')
    render(<SB {...defaultProps} />)
    return ds
  }

  it('hides the Total/Online/Offline stats footer', async () => {
    await renderStandalone([makeNode('n1', 'online'), makeNode('n2', 'offline')])
    expect(screen.queryByText('Total')).not.toBeInTheDocument()
    expect(screen.queryByText('Online')).not.toBeInTheDocument()
    expect(screen.queryByText('Offline')).not.toBeInTheDocument()
  })

  it('hides scan-dependent items but keeps canvas actions', async () => {
    await renderStandalone()
    expect(screen.queryByText('Scan Network')).not.toBeInTheDocument()
    expect(screen.queryByText('Device Inventory')).not.toBeInTheDocument()
    expect(screen.queryByText('Logout')).not.toBeInTheDocument()
    expect(screen.getByText('Add Node')).toBeInTheDocument()
    expect(screen.getByText('Save Canvas')).toBeInTheDocument()
  })

  it('creates a canvas via localStorage (no API) and adds it to the store', async () => {
    const ds = await renderStandalone([], [makeDesign('d1', 'Main')])

    fireEvent.click(screen.getByText('Main'))          // open switcher
    fireEvent.click(screen.getByText('New Canvas'))    // open create modal
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Garage' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await screen.findByText('Garage')
    expect(ds.getState().designs.map((d) => d.name)).toContain('Garage')
    expect(standaloneStorage.listDesigns().map((d) => d.name)).toContain('Garage')
  })

  it('renames a canvas via localStorage (no API)', async () => {
    standaloneStorage.createDesign('Old')
    const seeded = standaloneStorage.listDesigns()
    const ds = await renderStandalone([], seeded)

    fireEvent.click(screen.getByText('Old'))
    fireEvent.click(screen.getByLabelText('Edit Old'))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Renamed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await screen.findByText('Renamed')
    expect(ds.getState().designs.map((d) => d.name)).toContain('Renamed')
    expect(standaloneStorage.listDesigns()[0].name).toBe('Renamed')
  })

  it('deletes a canvas via localStorage (no API)', async () => {
    standaloneStorage.createDesign('Keep')
    standaloneStorage.createDesign('Drop')
    const seeded = standaloneStorage.listDesigns()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const ds = await renderStandalone([], seeded)

    fireEvent.click(screen.getByText('Keep'))          // open switcher
    fireEvent.click(screen.getByLabelText('Delete Drop'))

    expect(confirmSpy).toHaveBeenCalled()
    expect(standaloneStorage.listDesigns().map((d) => d.name)).toEqual(['Keep'])
    expect(ds.getState().designs.map((d) => d.name)).toEqual(['Keep'])
    confirmSpy.mockRestore()
  })
})

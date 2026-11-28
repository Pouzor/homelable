import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
import { Sidebar } from '../Sidebar'
import { useCanvasStore } from '@/stores/canvasStore'
import { useAuthStore } from '@/stores/authStore'
import { useUiStore } from '@/stores/uiStore'
import { useDesignStore } from '@/stores/designStore'
import { useDocsStore } from '@/documentation/store'
import { scanApi } from '@/api/client'
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
  designsApi: {
    reorder: vi.fn().mockResolvedValue({}),
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
  onOpenImports: vi.fn(),
  onSave: vi.fn(),
  onOpenSettings: vi.fn(),
  onOpenHistory: vi.fn(),
  onOpenInventory: vi.fn(),
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
    expect(screen.getByText('Scan History')).toBeInTheDocument()
  })

  it('spins the Scan History icon while a scan runs, and not otherwise', async () => {
    const icon = () => screen.getByText('Scan History').closest('button')!.querySelector('svg')!

    vi.mocked(scanApi.runs).mockResolvedValue({ data: [{ status: 'done' }] } as never)
    render(<Sidebar {...defaultProps} />)
    await waitFor(() => expect(scanApi.runs).toHaveBeenCalled())
    expect(icon().getAttribute('class')).not.toContain('animate-spin')

    cleanup()
    vi.mocked(scanApi.runs).mockResolvedValue({ data: [{ status: 'running' }] } as never)
    render(<Sidebar {...defaultProps} />)
    await waitFor(() => expect(icon().getAttribute('class')).toContain('animate-spin'))
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

  it('calls onOpenImports when Import from… is clicked', () => {
    render(<Sidebar {...defaultProps} />)
    fireEvent.click(screen.getByText('Import from…'))
    expect(defaultProps.onOpenImports).toHaveBeenCalledOnce()
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

  // ── Device Inventory opens the modal ───────────────────────────────────────

  it('calls onOpenInventory with pending status when Device Inventory is clicked', () => {
    render(<Sidebar {...defaultProps} />)
    fireEvent.click(screen.getByText('Device Inventory'))
    expect(defaultProps.onOpenInventory).toHaveBeenCalledWith(undefined, 'pending')
  })

  it('offers no Hidden Devices shortcut — the modal carries that filter', () => {
    render(<Sidebar {...defaultProps} />)
    expect(screen.queryByText('Hidden Devices')).not.toBeInTheDocument()
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

  // ── Walkthrough anchor ─────────────────────────────────────────────────────

  it('carries the walkthrough anchor the rack tour step spotlights', async () => {
    const { useDesignStore } = await import('@/stores/designStore')
    const { STEPS } = await import('@/walkthrough/steps')
    const before = useDesignStore.getState()
    useDesignStore.setState({
      designs: [{
        id: 'd1', name: 'Main', design_type: 'network', icon: null,
        created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
      }],
      activeDesignId: 'd1',
      loaded: true,
    })

    const { unmount } = render(<Sidebar {...defaultProps} />)

    const step = STEPS.find((s) => s.id === 'rack')
    expect(step?.anchor).toBe('[data-tour="canvas-switcher"]')
    // The overlay resolves that selector against the DOM — an anchor the sidebar
    // stops carrying leaves the step spotlighting nothing.
    expect(document.querySelector(step!.anchor!)).toBeInTheDocument()

    // The Documentation entry is the first Documentation step's target, and the
    // only way the tour has into the section.
    const docs = STEPS.find((s) => s.id === 'docs')
    expect(docs?.anchor).toBe('[data-tour="documentation"]')
    expect(document.querySelector(docs!.anchor!)).toBeInTheDocument()

    // The imports step now points at the single picker entry, not at one of the
    // per-source links it replaced.
    const imports = STEPS.find((s) => s.id === 'imports')
    expect(imports?.anchor).toBe('[data-tour="imports"]')
    expect(document.querySelector(imports!.anchor!)).toBeInTheDocument()

    // Unmount before restoring, so the store reset never re-renders the sidebar.
    unmount()
    useDesignStore.setState({
      designs: before.designs,
      activeDesignId: before.activeDesignId,
      loaded: before.loaded,
    })
  })
})

// ── Canvas order (#461) ──────────────────────────────────────────────────────

describe('Sidebar — canvas order', () => {
  const d = (id: string, name: string): Design => ({
    id, name, design_type: 'network', icon: null,
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  })

  beforeEach(async () => {
    mockStore()
    mockAuth()
    vi.clearAllMocks()
    const { useDesignStore } = await import('@/stores/designStore')
    useDesignStore.setState({
      designs: [d('a', 'Alpha'), d('b', 'Bravo'), d('c', 'Charlie')],
      activeDesignId: 'a',
      loaded: true,
    })
  })

  const order = async () => {
    const { useDesignStore } = await import('@/stores/designStore')
    return useDesignStore.getState().designs.map((x) => x.id)
  }

  it('disables Move up on the first canvas and Move down on the last', () => {
    render(<Sidebar {...defaultProps} />)
    fireEvent.click(screen.getByText('Alpha'))
    expect(screen.getByLabelText('Move Alpha up')).toBeDisabled()
    expect(screen.getByLabelText('Move Alpha down')).toBeEnabled()
    expect(screen.getByLabelText('Move Charlie up')).toBeEnabled()
    expect(screen.getByLabelText('Move Charlie down')).toBeDisabled()
  })

  // Regression: in-flow (opacity-0) row actions reserved their width and truncated names.
  it('overlays the row actions so they never take width from the canvas name', () => {
    render(<Sidebar {...defaultProps} />)
    fireEvent.click(screen.getByText('Alpha'))
    const actions = screen.getAllByTestId('design-row-actions')
    expect(actions).toHaveLength(3)
    for (const el of actions) {
      expect(el).toHaveClass('absolute', 'opacity-0', 'pointer-events-none', 'group-hover:opacity-100')
      expect(el.parentElement).toHaveClass('relative')
    }
    expect(screen.getByLabelText('Move Alpha down').closest('[data-testid="design-row-actions"]')).not.toBeNull()
    expect(screen.getByLabelText('Delete Alpha').closest('[data-testid="design-row-actions"]')).not.toBeNull()
  })

  it('moves a canvas and saves the whole order, keeping the switcher open', async () => {
    const { designsApi } = await import('@/api/client')
    render(<Sidebar {...defaultProps} />)
    fireEvent.click(screen.getByText('Alpha'))
    fireEvent.click(screen.getByLabelText('Move Alpha down'))
    expect(await order()).toEqual(['b', 'a', 'c'])
    expect(designsApi.reorder).toHaveBeenCalledWith(['b', 'a', 'c'])
    fireEvent.click(screen.getByLabelText('Move Charlie up'))
    expect(await order()).toEqual(['b', 'c', 'a'])
    expect(designsApi.reorder).toHaveBeenLastCalledWith(['b', 'c', 'a'])
  })

  it('rolls the order back and warns when the save fails', async () => {
    const { designsApi } = await import('@/api/client')
    const { toast } = await import('sonner')
    vi.mocked(designsApi.reorder).mockRejectedValueOnce(new Error('boom'))
    render(<Sidebar {...defaultProps} />)
    fireEvent.click(screen.getByText('Alpha'))
    fireEvent.click(screen.getByLabelText('Move Bravo up'))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to reorder canvases'))
    expect(await order()).toEqual(['a', 'b', 'c'])
  })
})

// ── Rack canvas ────────────────────────────────────────────────────────────────
// Same component, a different half of it: the rack branch swaps the view label,
// the actions, the body and the footer. A mocked canvas store would happily hide
// all of that, so each branch is asserted rather than assumed.
describe('Sidebar (rack canvas)', () => {
  let restore: { designs: Design[]; activeDesignId: string | null; activeDesignType: string }

  beforeEach(async () => {
    mockStore()
    mockAuth()
    const { useDesignStore } = await import('@/stores/designStore')
    const { useRackStore } = await import('@/rack/store')
    const s = useDesignStore.getState()
    restore = { designs: s.designs, activeDesignId: s.activeDesignId, activeDesignType: s.activeDesignType }
    useDesignStore.setState({ activeDesignType: 'rack' })
    useRackStore.getState().loadDemo()
  })

  afterEach(async () => {
    cleanup()
    const { useDesignStore } = await import('@/stores/designStore')
    useDesignStore.setState(restore)
  })

  it('swaps the view and the actions for their rack equivalents', () => {
    render(<Sidebar {...defaultProps} />)
    expect(screen.getByText('Rack view')).toBeInTheDocument()
    expect(screen.getByText('Add Device')).toBeInTheDocument()
    expect(screen.getByText('Save Rack')).toBeInTheDocument()
    expect(screen.queryByText('Canvas')).not.toBeInTheDocument()
    expect(screen.queryByText('Add Node')).not.toBeInTheDocument()
    expect(screen.queryByText('Add Zone')).not.toBeInTheDocument()
    expect(screen.queryByText('Add Text')).not.toBeInTheDocument()
  })

  it('hides the logical-canvas discovery actions', () => {
    render(<Sidebar {...defaultProps} />)
    // Nothing here is scanned onto a rack — those actions belong to a diagram.
    expect(screen.queryByText('Scan Network')).not.toBeInTheDocument()
    expect(screen.queryByText('Import from…')).not.toBeInTheDocument()
    // The Device Inventory stays: a rack mounts what the scans found.
    expect(screen.getByText('Device Inventory')).toBeInTheDocument()
  })

  it('opens the device editor from + Device', async () => {
    const { useRackStore } = await import('@/rack/store')
    render(<Sidebar {...defaultProps} />)

    fireEvent.click(screen.getByText('Add Device'))
    expect(useRackStore.getState().deviceEditor).toEqual({ deviceId: null })
  })

  it('counts capacity instead of reachability', async () => {
    const { useRackStore } = await import('@/rack/store')
    const { freeUnits } = await import('@/rack/layout')
    const { racks, devices, cables } = useRackStore.getState()
    const free = racks.reduce((sum, r) => sum + freeUnits(r, devices), 0)
    const total = racks.reduce((sum, r) => sum + r.uHeight, 0)

    render(<Sidebar {...defaultProps} />)

    expect(screen.getByText('Racks').nextElementSibling).toHaveTextContent(String(racks.length))
    expect(screen.getByText('Mounted').nextElementSibling).toHaveTextContent(String(devices.length))
    expect(screen.getByText('Cables').nextElementSibling).toHaveTextContent(String(cables.length))
    expect(screen.getByText(`${free}U / ${total}U`)).toBeInTheDocument()
    expect(screen.queryByText('Online')).not.toBeInTheDocument()
  })

  it('tracks the rack store for the unsaved badge, not the canvas store', async () => {
    const { useRackStore } = await import('@/rack/store')
    useRackStore.setState({ hasUnsavedChanges: true })
    // The canvas store — mocked clean — must not be what answers here.
    const { container } = render(<Sidebar {...defaultProps} />)
    expect(container.querySelector('.bg-warning')).toBeInTheDocument()

    cleanup()
    useRackStore.setState({ hasUnsavedChanges: false })
    const { container: clean } = render(<Sidebar {...defaultProps} />)
    expect(clean.querySelector('.bg-warning')).toBeNull()
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

  it('reorders canvases via localStorage (no API)', async () => {
    standaloneStorage.createDesign('First')
    standaloneStorage.createDesign('Second')
    const ds = await renderStandalone([], standaloneStorage.listDesigns())

    fireEvent.click(screen.getByText('First'))         // open switcher
    fireEvent.click(screen.getByLabelText('Move Second up'))

    expect(standaloneStorage.listDesigns().map((d) => d.name)).toEqual(['Second', 'First'])
    expect(ds.getState().designs.map((d) => d.name)).toEqual(['Second', 'First'])
  })
})

describe('Sidebar — Documentation entry', () => {
  beforeEach(() => {
    mockStore()
    mockAuth()
    vi.clearAllMocks()
  })

  it('switches to Documentation and asks the docs store to open the homepage', () => {
    const openHome = vi.fn().mockResolvedValue(true)
    useDocsStore.setState({ openHome })
    render(<Sidebar {...defaultProps} />)
    fireEvent.click(screen.getByText('Documentation'))
    expect(useUiStore.getState().view).toBe('documentation')
    expect(openHome).toHaveBeenCalledTimes(1)
  })
})

describe('Sidebar — navigation drawer (every screen size)', () => {
  beforeEach(() => {
    // An earlier test can leave a modal portal open, which marks the rest of
    // the page inert for role queries.
    cleanup()
    // With the canvas store mocked whole, the floor-plan edit nonce reads as
    // truthy, so an active design left by an earlier test opens its modal.
    useDesignStore.setState({ designs: [], activeDesignId: null })
    mockStore()
    mockAuth()
    vi.clearAllMocks()
  })
  afterEach(() => {
    cleanup()
    useUiStore.setState({ navOpen: false, view: 'canvas' })
  })

  const items = () => Array.from(document.querySelectorAll<HTMLElement>('#app-navigation [data-nav-item]'))

  it('is inert and off-screen until the hamburger opens it, with no collapse rail', () => {
    useUiStore.setState({ navOpen: false })
    render(<Sidebar {...defaultProps} />)
    const aside = screen.getByRole('complementary', { hidden: true })
    expect(aside).toHaveAttribute('inert')
    expect(aside.className).toContain('-translate-x-full')
    expect(screen.queryByTestId('nav-backdrop')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /collapse sidebar/i, hidden: true })).not.toBeInTheDocument()
  })

  it('shows every item with its label when open', () => {
    useUiStore.setState({ navOpen: true })
    render(<Sidebar {...defaultProps} />)
    expect(screen.getByRole('complementary')).not.toHaveAttribute('inert')
    for (const label of ['Canvas', 'Documentation', 'Device Inventory', 'Scan History', 'Add Node', 'Add Zone', 'Add Text', 'Scan Network', 'Import from…', 'Save Canvas', 'Settings', 'Logout']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })

  it('moves focus to the current section when it opens', async () => {
    useUiStore.setState({ navOpen: false, view: 'documentation' })
    render(<Sidebar {...defaultProps} />)
    act(() => useUiStore.setState({ navOpen: true }))
    await waitFor(() => expect(document.activeElement).toHaveAttribute('aria-current', 'page'))
    expect(document.activeElement?.textContent).toContain('Documentation')
  })

  it('arrow keys, Home and End move between items', async () => {
    useUiStore.setState({ navOpen: true })
    render(<Sidebar {...defaultProps} />)
    const all = items()
    await waitFor(() => expect(document.activeElement).toBe(all.find((el) => el.getAttribute('aria-current') === 'page') ?? all[0]))
    const start = all.indexOf(document.activeElement as HTMLElement)
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(all[start + 1])
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(all[start])
    fireEvent.keyDown(document.activeElement!, { key: 'End' })
    expect(document.activeElement).toBe(all[all.length - 1])
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(all[0])
    fireEvent.keyDown(document.activeElement!, { key: 'Home' })
    expect(document.activeElement).toBe(all[0])
  })

  it('Tab wraps inside the open drawer', () => {
    useUiStore.setState({ navOpen: true })
    render(<Sidebar {...defaultProps} />)
    const aside = screen.getByRole('complementary')
    const focusables = Array.from(aside.querySelectorAll<HTMLElement>('a[href], button:not([disabled])'))
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    last.focus()
    fireEvent.keyDown(last, { key: 'Tab' })
    expect(document.activeElement).toBe(first)
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
  })

  it('Escape closes it and hands focus back to the button that opened it', async () => {
    const opener = document.createElement('button')
    opener.textContent = 'open'
    document.body.appendChild(opener)
    opener.focus()
    useUiStore.setState({ navOpen: false })
    render(<Sidebar {...defaultProps} />)
    act(() => useUiStore.setState({ navOpen: true }))
    await waitFor(() => expect(screen.getByRole('complementary').contains(document.activeElement)).toBe(true))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(useUiStore.getState().navOpen).toBe(false)
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  it('closes after an item is used', () => {
    useUiStore.setState({ navOpen: true })
    render(<Sidebar {...defaultProps} />)
    fireEvent.click(screen.getByText('Settings'))
    expect(defaultProps.onOpenSettings).toHaveBeenCalled()
    expect(useUiStore.getState().navOpen).toBe(false)
  })

  it('closes from the backdrop and the close button', () => {
    useUiStore.setState({ navOpen: true })
    render(<Sidebar {...defaultProps} />)
    fireEvent.click(screen.getByTestId('nav-backdrop'))
    expect(useUiStore.getState().navOpen).toBe(false)

    act(() => useUiStore.setState({ navOpen: true }))
    fireEvent.click(screen.getByRole('button', { name: 'Close navigation' }))
    expect(useUiStore.getState().navOpen).toBe(false)
  })
})

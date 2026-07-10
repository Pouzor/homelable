import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Toolbar } from '../Toolbar'
import { useCanvasStore } from '@/stores/canvasStore'

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@/stores/canvasStore')

vi.mock('@/components/ui/Logo', () => ({
  Logo: () => <div data-testid="logo" />,
}))

function mockStore(overrides: Partial<ReturnType<typeof useCanvasStore>> = {}) {
  vi.mocked(useCanvasStore).mockReturnValue({
    hasUnsavedChanges: false,
    past: [],
    future: [],
    ...overrides,
  } as ReturnType<typeof useCanvasStore>)
}

const defaultProps = {
  onSave: vi.fn(),
  onAutoLayout: vi.fn(),
  onExport: vi.fn(),
  onChangeStyle: vi.fn(),
  onUndo: vi.fn(),
  onRedo: vi.fn(),
  onShortcuts: vi.fn(),
  onExportMd: vi.fn(),
  onExportYaml: vi.fn(),
  onImportYaml: vi.fn(),
  onViewOnly: vi.fn(),
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Toolbar', () => {
  beforeEach(() => {
    mockStore()
    vi.clearAllMocks()
  })

  it('calls onSave when Save is clicked', () => {
    render(<Toolbar {...defaultProps} />)
    fireEvent.click(screen.getByText('Save'))
    expect(defaultProps.onSave).toHaveBeenCalledOnce()
  })

  // Regression (#186): the click handler must not forward the MouseEvent as an
  // argument — handleSave treats its first arg as a designIdOverride, so leaking
  // the event corrupts design_id and the save silently fails.
  it('calls onSave with no arguments (does not leak the click event)', () => {
    render(<Toolbar {...defaultProps} />)
    fireEvent.click(screen.getByText('Save'))
    expect(defaultProps.onSave).toHaveBeenCalledWith()
  })

  it('shows the View (live view) link in full mode', () => {
    render(<Toolbar {...defaultProps} />)
    expect(screen.getByText('View')).toBeInTheDocument()
  })

  // These cover the store→UI wiring the seam mock would otherwise hide: the
  // undo/redo disabled state and the unsaved dot are driven purely by store
  // state, so assert them against the mocked slices.
  it('disables Undo when the history stack is empty and Redo when the future is empty', () => {
    mockStore({ past: [], future: [] })
    render(<Toolbar {...defaultProps} />)
    expect(screen.getByTitle('Undo (Ctrl+Z)')).toBeDisabled()
    expect(screen.getByTitle('Redo (Ctrl+Y)')).toBeDisabled()
  })

  it('enables Undo/Redo when history/future have entries and forwards the clicks', () => {
    mockStore({ past: [{}], future: [{}] } as Partial<ReturnType<typeof useCanvasStore>>)
    render(<Toolbar {...defaultProps} />)
    const undo = screen.getByTitle('Undo (Ctrl+Z)')
    const redo = screen.getByTitle('Redo (Ctrl+Y)')
    expect(undo).toBeEnabled()
    expect(redo).toBeEnabled()
    fireEvent.click(undo)
    fireEvent.click(redo)
    expect(defaultProps.onUndo).toHaveBeenCalledOnce()
    expect(defaultProps.onRedo).toHaveBeenCalledOnce()
  })

  it('renders the unsaved-changes dot only when hasUnsavedChanges is true', () => {
    const { rerender } = render(<Toolbar {...defaultProps} />)
    // Save button is the last button; the dot is a sibling span with bg-[#e3b341].
    expect(document.querySelector('.bg-\\[\\#e3b341\\]')).toBeNull()

    mockStore({ hasUnsavedChanges: true })
    rerender(<Toolbar {...defaultProps} />)
    expect(document.querySelector('.bg-\\[\\#e3b341\\]')).not.toBeNull()
  })
})

// ── Standalone mode ────────────────────────────────────────────────────────────
// VITE_STANDALONE is read at module load, so re-import Toolbar after stubbing it.
describe('Toolbar (standalone)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('hides the View link (live view is pointless without a backend)', async () => {
    vi.stubEnv('VITE_STANDALONE', 'true')
    vi.resetModules()
    const { useCanvasStore: cs } = await import('@/stores/canvasStore')
    vi.mocked(cs).mockReturnValue({
      hasUnsavedChanges: false, past: [], future: [],
    } as ReturnType<typeof useCanvasStore>)
    const { Toolbar: TB } = await import('../Toolbar')

    render(<TB {...defaultProps} />)
    expect(screen.queryByText('View')).not.toBeInTheDocument()
    // Other actions remain.
    expect(screen.getByText('Save')).toBeInTheDocument()
    expect(screen.getByText('MD')).toBeInTheDocument()
  })
})

import { describe, it, expect, beforeEach, vi } from 'vitest'
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
})

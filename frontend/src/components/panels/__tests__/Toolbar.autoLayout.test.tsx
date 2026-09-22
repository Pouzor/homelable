import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Toolbar } from '../Toolbar'
import { useCanvasStore } from '@/stores/canvasStore'

vi.mock('@/stores/canvasStore')

vi.mock('@/components/ui/Logo', () => ({
  Logo: () => <div data-testid="logo" />,
}))

const props = {
  onSave: vi.fn(),
  onAutoLayout: vi.fn(),
  onExport: vi.fn(),
  onChangeStyle: vi.fn(),
  onUndo: vi.fn(),
  onRedo: vi.fn(),
  onShortcuts: vi.fn(),
  onExportYaml: vi.fn(),
  onImportYaml: vi.fn(),
  onViewOnly: vi.fn(),
}

describe('Toolbar — Auto Layout modes (#326)', () => {
  beforeEach(() => {
    vi.mocked(useCanvasStore).mockReturnValue({
      hasUnsavedChanges: false,
      past: [],
      future: [],
    } as unknown as ReturnType<typeof useCanvasStore>)
    vi.clearAllMocks()
  })

  it('runs the plain hierarchy from the main button, without leaking the click event', () => {
    render(<Toolbar {...props} />)
    fireEvent.click(screen.getByText('Auto Layout'))
    expect(props.onAutoLayout).toHaveBeenCalledWith('hierarchy')
  })

  it('keeps the mode menu closed until the chevron opens it', () => {
    render(<Toolbar {...props} />)
    const chevron = screen.getByLabelText('More layout options')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(chevron).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(chevron)
    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(chevron).toHaveAttribute('aria-expanded', 'true')
    expect(props.onAutoLayout).not.toHaveBeenCalled()
  })

  it.each([
    ['Group by device type', 'type'],
    ['Group by subnet', 'subnet'],
  ])('%s runs the %s mode and closes the menu', (label, mode) => {
    render(<Toolbar {...props} />)
    fireEvent.click(screen.getByLabelText('More layout options'))
    fireEvent.click(screen.getByText(label))
    expect(props.onAutoLayout).toHaveBeenCalledWith(mode)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('closes the menu on Escape and on a click outside it', () => {
    render(<Toolbar {...props} />)
    const chevron = screen.getByLabelText('More layout options')

    fireEvent.click(chevron)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()

    fireEvent.click(chevron)
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
    expect(props.onAutoLayout).not.toHaveBeenCalled()
  })
})

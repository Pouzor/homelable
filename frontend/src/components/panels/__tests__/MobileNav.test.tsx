import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { Toolbar } from '../Toolbar'
import { NavMenuButton, DocsHeader } from '../MobileTopBar'
import { useCanvasStore } from '@/stores/canvasStore'
import { useUiStore } from '@/stores/uiStore'
import { useDocsStore } from '@/documentation/store'

vi.mock('@/stores/canvasStore')
vi.mock('@/components/ui/Logo', () => ({ Logo: () => <div data-testid="logo" /> }))
vi.mock('sonner', async () => (await import('@/test/mocks')).mockSonner())

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

function mockCanvas(overrides: Record<string, unknown> = {}) {
  vi.mocked(useCanvasStore).mockReturnValue({
    hasUnsavedChanges: false, past: [], future: [], ...overrides,
  } as unknown as ReturnType<typeof useCanvasStore>)
}

describe('NavMenuButton', () => {
  afterEach(() => useUiStore.setState({ navOpen: false }))

  it('opens the navigation drawer and advertises the M shortcut', () => {
    render(<NavMenuButton />)
    const btn = screen.getByRole('button', { name: 'Open navigation' })
    expect(btn).toHaveAttribute('aria-expanded', 'false')
    expect(btn).toHaveAttribute('aria-controls', 'app-navigation')
    expect(btn).toHaveAttribute('aria-keyshortcuts', 'm')
    fireEvent.click(btn)
    expect(useUiStore.getState().navOpen).toBe(true)
  })
})

describe('Toolbar on a phone', () => {
  beforeEach(() => { mockCanvas(); vi.clearAllMocks(); mockCanvas() })
  afterEach(() => { cleanup(); useUiStore.setState({ canvasLocked: false }) })

  const openMenu = () => fireEvent.click(screen.getByRole('button', { name: 'More canvas actions' }))

  it('keeps every toolbar action reachable from the overflow menu', () => {
    render(<Toolbar {...props} />)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    openMenu()
    const menu = screen.getByRole('menu', { name: 'Canvas actions' })
    const labels = [...menu.querySelectorAll('[role="menuitem"]')].map((el) => el.textContent)
    expect(labels).toEqual([
      'Undo', 'Redo', 'Auto Layout', 'Group by device type', 'Group by subnet',
      'Style', 'Import YAML', 'Export YAML', 'Download PNG', 'Live view (read-only)',
    ])
  })

  it('runs the picked action and closes the menu', () => {
    render(<Toolbar {...props} />)
    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Group by subnet' }))
    expect(props.onAutoLayout).toHaveBeenCalledWith('subnet')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Download PNG' }))
    expect(props.onExport).toHaveBeenCalledOnce()
  })

  it('disables Undo and Redo in the menu with no history', () => {
    render(<Toolbar {...props} />)
    openMenu()
    expect(screen.getByRole('menuitem', { name: 'Undo' })).toBeDisabled()
    expect(screen.getByRole('menuitem', { name: 'Redo' })).toBeDisabled()
  })

  it('closes the menu on Escape', () => {
    render(<Toolbar {...props} />)
    openMenu()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('the lock toggle switches between view and edit mode', () => {
    render(<Toolbar {...props} />)
    fireEvent.click(screen.getByRole('button', { name: /Canvas unlocked/ }))
    expect(useUiStore.getState().canvasLocked).toBe(true)
    expect(screen.getByText('Viewing')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Canvas locked/ }))
    expect(useUiStore.getState().canvasLocked).toBe(false)
    expect(screen.getByText('Editing')).toBeInTheDocument()
  })
})

describe('DocsHeader', () => {
  afterEach(() => { cleanup(); useDocsStore.setState({ openDoc: null, dirty: false }) })

  it('titles the list when no document is open', () => {
    useDocsStore.setState({ openDoc: null })
    render(<DocsHeader />)
    expect(screen.getAllByText('Documentation').length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: /Documents/ })).not.toBeInTheDocument()
  })

  it('goes back to the list from an open document', () => {
    useDocsStore.setState({ openDoc: { id: 'd1', title: 'pve01' } as never, dirty: false })
    render(<DocsHeader />)
    expect(screen.getByText('pve01')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Documents/ }))
    expect(useDocsStore.getState().openDoc).toBeNull()
  })

  it('will not drop an unsaved edit', () => {
    useDocsStore.setState({ openDoc: { id: 'd1', title: 'pve01' } as never, dirty: true })
    render(<DocsHeader />)
    fireEvent.click(screen.getByRole('button', { name: /Documents/ }))
    expect(useDocsStore.getState().openDoc).not.toBeNull()
  })
})

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { NodeModal } from '../NodeModal'
import type { NodeData } from '@/types'

// ── Mock Shadcn Select with native <select> for testability ───────────────

vi.mock('@/components/ui/select', () => ({
  Select: ({ value, onValueChange, children }: {
    value?: string; onValueChange?: (v: string) => void; children: React.ReactNode
  }) => (
    <select value={value} onChange={(e) => onValueChange?.(e.target.value)}>
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectGroup: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectLabel: () => null,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => (
    <option value={value}>{children}</option>
  ),
  SelectSeparator: () => null,
}))

// ── Helpers ───────────────────────────────────────────────────────────────

function renderModal(props: Partial<Parameters<typeof NodeModal>[0]> = {}) {
  const onClose = vi.fn()
  const onSubmit = vi.fn()
  render(<NodeModal open onClose={onClose} onSubmit={onSubmit} {...props} />)
  return { onClose, onSubmit }
}

/** Get <select> elements in document order: [0]=Type, [1]=CheckMethod, [2]=BottomHandles */
function selects() { return screen.getAllByRole('combobox') as HTMLSelectElement[] }

const BASE: Partial<NodeData> = {
  type: 'server', label: 'My Server', hostname: 'server.lan',
  ip: '192.168.1.10', check_method: 'ping', services: [],
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('NodeModal', () => {

  // ── Visibility ────────────────────────────────────────────────────────

  it('renders nothing when closed', () => {
    const { container } = render(<NodeModal open={false} onClose={vi.fn()} onSubmit={vi.fn()} />)
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })

  it('renders form fields when open', () => {
    renderModal()
    expect(screen.getByPlaceholderText('My Server')).toBeDefined()
    expect(screen.getByText('Add Node')).toBeDefined()
  })

  it('shows "Add" button for default title', () => {
    renderModal()
    expect(screen.getByRole('button', { name: 'Add' })).toBeDefined()
  })

  it('shows "Save" button when title is Edit Node', () => {
    renderModal({ title: 'Edit Node' })
    expect(screen.getByRole('button', { name: 'Save' })).toBeDefined()
  })

  it('pre-fills form from initial prop', () => {
    renderModal({ initial: BASE })
    expect((screen.getByPlaceholderText('My Server') as HTMLInputElement).value).toBe('My Server')
    expect((screen.getByPlaceholderText('server.lan') as HTMLInputElement).value).toBe('server.lan')
    expect((screen.getByPlaceholderText('192.168.1.x, 2001:db8::1') as HTMLInputElement).value).toBe('192.168.1.10')
  })

  // ── Cancel ────────────────────────────────────────────────────────────

  it('calls onClose when Cancel is clicked', () => {
    const { onClose } = renderModal()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  // ── Label validation ──────────────────────────────────────────────────

  it('blocks submit and shows error when label is empty', () => {
    const { onSubmit } = renderModal()
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText('Label is required')).toBeDefined()
  })

  it('blocks submit when label is whitespace only', () => {
    const { onSubmit } = renderModal()
    fireEvent.change(screen.getByPlaceholderText('My Server'), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('clears label error when user starts typing', () => {
    renderModal()
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    fireEvent.change(screen.getByPlaceholderText('My Server'), { target: { value: 'x' } })
    expect(screen.queryByText('Label is required')).toBeNull()
  })

  // ── Form submission ───────────────────────────────────────────────────

  it('calls onSubmit and onClose with form data on valid submit', () => {
    const { onSubmit, onClose } = renderModal({ initial: BASE })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(onSubmit).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
    const data = onSubmit.mock.calls[0][0] as Partial<NodeData>
    expect(data.label).toBe('My Server')
    expect(data.type).toBe('server')
  })

  it('submits updated hostname, IP and notes', () => {
    const { onSubmit } = renderModal({ initial: BASE })
    fireEvent.change(screen.getByPlaceholderText('server.lan'), { target: { value: 'nas.local' } })
    fireEvent.change(screen.getByPlaceholderText('192.168.1.x, 2001:db8::1'), { target: { value: '10.0.0.1' } })
    fireEvent.change(screen.getByPlaceholderText('Optional notes'), { target: { value: 'rack A' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    const data = onSubmit.mock.calls[0][0] as Partial<NodeData>
    expect(data.hostname).toBe('nas.local')
    expect(data.ip).toBe('10.0.0.1')
    expect(data.notes).toBe('rack A')
  })

  it('resets form values when reopened in Add mode', () => {
    const onClose = vi.fn()
    const onSubmit = vi.fn()

    const { rerender } = render(<NodeModal key="open-1" open onClose={onClose} onSubmit={onSubmit} />)
    fireEvent.change(screen.getByPlaceholderText('My Server'), { target: { value: 'Temp Node' } })
    fireEvent.change(screen.getByPlaceholderText('server.lan'), { target: { value: 'temp.local' } })

    rerender(<NodeModal key="closed" open={false} onClose={onClose} onSubmit={onSubmit} />)
    rerender(<NodeModal key="open-2" open onClose={onClose} onSubmit={onSubmit} />)

    expect((screen.getByPlaceholderText('My Server') as HTMLInputElement).value).toBe('')
    expect((screen.getByPlaceholderText('server.lan') as HTMLInputElement).value).toBe('')
  })

  it('submits check_target', () => {
    const { onSubmit } = renderModal({ initial: BASE })
    fireEvent.change(screen.getByPlaceholderText('http://...'), { target: { value: 'http://192.168.1.10:8080' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect((onSubmit.mock.calls[0][0] as Partial<NodeData>).check_target).toBe('http://192.168.1.10:8080')
  })

  // ── Type selector ─────────────────────────────────────────────────────

  it('pre-fills type from initial', () => {
    renderModal({ initial: { ...BASE, type: 'router' } })
    expect(selects()[0].value).toBe('router')
  })

  it('changes type and submits it', () => {
    const { onSubmit } = renderModal({ initial: BASE })
    fireEvent.change(selects()[0], { target: { value: 'nas' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect((onSubmit.mock.calls[0][0] as Partial<NodeData>).type).toBe('nas')
  })

  // ── Check method ──────────────────────────────────────────────────────

  it('pre-fills check_method from initial', () => {
    renderModal({ initial: { ...BASE, check_method: 'http' } })
    expect(selects()[1].value).toBe('http')
  })

  it('changes check_method and submits it', () => {
    const { onSubmit } = renderModal({ initial: BASE })
    fireEvent.change(selects()[1], { target: { value: 'ssh' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect((onSubmit.mock.calls[0][0] as Partial<NodeData>).check_method).toBe('ssh')
  })

  // ── Icon picker ───────────────────────────────────────────────────────

  it('shows "Default" label when no custom icon', () => {
    renderModal({ initial: BASE })
    expect(screen.getByText('Default')).toBeDefined()
  })

  it('opens icon picker on trigger button click', () => {
    renderModal({ initial: BASE })
    expect(screen.queryByPlaceholderText('Search icons…')).toBeNull()
    fireEvent.click(screen.getByText('Default'))
    expect(screen.getByPlaceholderText('Search icons…')).toBeDefined()
  })

  it('closes picker and shows icon label after selecting an icon', () => {
    renderModal({ initial: BASE })
    fireEvent.click(screen.getByText('Default'))
    fireEvent.click(screen.getByTitle('Database (SQL/NoSQL)'))
    expect(screen.queryByPlaceholderText('Search icons…')).toBeNull()
    expect(screen.getByText('Database (SQL/NoSQL)')).toBeDefined()
  })

  it('submits custom_icon key after picking', () => {
    const { onSubmit } = renderModal({ initial: BASE })
    fireEvent.click(screen.getByText('Default'))
    fireEvent.click(screen.getByTitle('Database (SQL/NoSQL)'))
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect((onSubmit.mock.calls[0][0] as Partial<NodeData>).custom_icon).toBe('database')
  })

  it('shows Reset button when custom_icon is set', () => {
    renderModal({ initial: { ...BASE, custom_icon: 'database' } })
    expect(screen.getByRole('button', { name: /Reset/i })).toBeDefined()
  })

  it('hides Reset button when no custom_icon', () => {
    renderModal({ initial: BASE })
    expect(screen.queryByRole('button', { name: /Reset/i })).toBeNull()
  })

  it('resets custom_icon and shows Default on Reset click', () => {
    renderModal({ initial: { ...BASE, custom_icon: 'database' } })
    fireEvent.click(screen.getByRole('button', { name: /Reset/i }))
    expect(screen.getByText('Default')).toBeDefined()
  })

  it('filters icons by search query', () => {
    renderModal({ initial: BASE })
    fireEvent.click(screen.getByText('Default'))
    fireEvent.change(screen.getByPlaceholderText('Search icons…'), { target: { value: 'grafana' } })
    expect(screen.getByTitle('Grafana / Kibana')).toBeDefined()
    expect(screen.queryByTitle('Router')).toBeNull()
  })

  // ── Container mode ─────────────────────────────────────────────────────

  it('shows Container Mode toggle for proxmox type', () => {
    renderModal({ initial: { ...BASE, type: 'proxmox' } })
    expect(screen.getByText('Container Mode')).toBeDefined()
  })

  it('hides Container Mode for server type', () => {
    renderModal({ initial: { ...BASE, type: 'server' } })
    expect(screen.queryByText('Container Mode')).toBeNull()
  })

  it('hides Container Mode for groupRect type', () => {
    renderModal({ initial: { ...BASE, type: 'groupRect' } })
    expect(screen.queryByText('Container Mode')).toBeNull()
  })

  it('toggles container_mode on click', () => {
    const { onSubmit } = renderModal({ initial: { ...BASE, type: 'proxmox', container_mode: true } })
    fireEvent.click(screen.getByRole('switch'))
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect((onSubmit.mock.calls[0][0] as Partial<NodeData>).container_mode).toBe(false)
  })

  // ── Parent container ──────────────────────────────────────────────────

  it('shows Parent Container when options are provided', () => {
    renderModal({
      initial: { ...BASE, type: 'server' },
      parentContainerNodes: [{ id: 'c1', label: 'Container 01' }],
    })
    expect(screen.getByText('Parent Container')).toBeDefined()
    expect(screen.getByText('Container 01')).toBeDefined()
  })

  it('hides Parent Container for groupRect type', () => {
    renderModal({ initial: { ...BASE, type: 'groupRect' }, parentContainerNodes: [{ id: 'c1', label: 'Container 01' }] })
    expect(screen.queryByText('Parent Container')).toBeNull()
  })

  it('hides Parent Container when no container options are available', () => {
    renderModal({ initial: { ...BASE, type: 'server' } })
    expect(screen.queryByText('Parent Container')).toBeNull()
  })

  // ── Appearance ────────────────────────────────────────────────────────

  it('renders 3 color swatch labels (border, background, icon)', () => {
    renderModal({ initial: BASE })
    expect(screen.getByText('border')).toBeDefined()
    expect(screen.getByText('background')).toBeDefined()
    expect(screen.getByText('icon')).toBeDefined()
  })

  it('shows default colors hint when no custom_colors', () => {
    renderModal({ initial: BASE })
    expect(screen.getByText(/Using default colors for/)).toBeDefined()
  })

  it('shows Reset to defaults when custom_colors are set', () => {
    renderModal({ initial: { ...BASE, custom_colors: { border: '#ff0000' } } })
    expect(screen.getByText('Reset to defaults')).toBeDefined()
  })

  it('resets custom_colors on Reset to defaults click', () => {
    renderModal({ initial: { ...BASE, custom_colors: { border: '#ff0000' } } })
    fireEvent.click(screen.getByText('Reset to defaults'))
    expect(screen.queryByText('Reset to defaults')).toBeNull()
    expect(screen.getByText(/Using default colors for/)).toBeDefined()
  })

  // ── Bottom connection points ───────────────────────────────────────────

  it('shows Bottom Connection Points for server type', () => {
    renderModal({ initial: BASE })
    expect(screen.getByText('Bottom Connection Points')).toBeDefined()
  })

  it('hides Bottom Connection Points for groupRect', () => {
    renderModal({ initial: { ...BASE, type: 'groupRect' } })
    expect(screen.queryByText('Bottom Connection Points')).toBeNull()
  })

  it('hides Bottom Connection Points for group', () => {
    renderModal({ initial: { ...BASE, type: 'group' } })
    expect(screen.queryByText('Bottom Connection Points')).toBeNull()
  })

  it('defaults bottom_handles to 1', () => {
    renderModal({ initial: BASE })
    expect(selects()[2].value).toBe('1')
  })

  it('pre-fills bottom_handles from initial', () => {
    renderModal({ initial: { ...BASE, bottom_handles: 3 } })
    expect(selects()[2].value).toBe('3')
  })

  it('submits updated bottom_handles', () => {
    const { onSubmit } = renderModal({ initial: BASE })
    fireEvent.change(selects()[2], { target: { value: '4' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect((onSubmit.mock.calls[0][0] as Partial<NodeData>).bottom_handles).toBe(4)
  })
})

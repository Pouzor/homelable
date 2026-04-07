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
    expect((screen.getByPlaceholderText('192.168.1.x') as HTMLInputElement).value).toBe('192.168.1.10')
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
    fireEvent.change(screen.getByPlaceholderText('192.168.1.x'), { target: { value: '10.0.0.1' } })
    fireEvent.change(screen.getByPlaceholderText('Optional notes'), { target: { value: 'rack A' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    const data = onSubmit.mock.calls[0][0] as Partial<NodeData>
    expect(data.hostname).toBe('nas.local')
    expect(data.ip).toBe('10.0.0.1')
    expect(data.notes).toBe('rack A')
  })

  it('submits explicit width and height when provided', () => {
    const onSubmit = vi.fn()
    render(<NodeModal open onClose={vi.fn()} onSubmit={onSubmit} />)
    fireEvent.change(screen.getByPlaceholderText('My Server'), { target: { value: 'Sized Node' } })
    const numericInputs = screen.getAllByRole('spinbutton')
    fireEvent.change(numericInputs[0], { target: { value: '240' } })
    fireEvent.change(numericInputs[1], { target: { value: '100' } })
    fireEvent.click(screen.getByText('Add'))
    expect(onSubmit.mock.calls[0][1]).toEqual({ width: 240, height: 100 })
  })

  it('pre-fills width and height from initialDimensions', () => {
    render(
      <NodeModal
        open
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        initial={{ label: 'Sized' }}
        initialDimensions={{ width: 320, height: 160 }}
      />
    )
    const numericInputs = screen.getAllByRole('spinbutton')
    expect((numericInputs[0] as HTMLInputElement).value).toBe('320')
    expect((numericInputs[1] as HTMLInputElement).value).toBe('160')
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

  // ── Container mode (proxmox only) ─────────────────────────────────────

  it('shows Container Mode toggle for proxmox type', () => {
    renderModal({ initial: { ...BASE, type: 'proxmox' } })
    expect(screen.getByText('Container Mode')).toBeDefined()
  })

  it('hides Container Mode for non-proxmox types', () => {
    renderModal({ initial: BASE })
    expect(screen.queryByText('Container Mode')).toBeNull()
  })

  it('toggles container_mode on click', () => {
    const { onSubmit } = renderModal({ initial: { ...BASE, type: 'proxmox', container_mode: true } })
    fireEvent.click(screen.getByRole('switch'))
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect((onSubmit.mock.calls[0][0] as Partial<NodeData>).container_mode).toBe(false)
  })

  // ── Parent Proxmox (vm / lxc only) ───────────────────────────────────

  it('shows Parent Proxmox for vm with proxmoxNodes', () => {
    renderModal({
      initial: { ...BASE, type: 'vm' },
      proxmoxNodes: [{ id: 'px1', label: 'PVE-01' }],
    })
    expect(screen.getByText('Parent Proxmox')).toBeDefined()
    expect(screen.getByText('PVE-01')).toBeDefined()
  })

  it('shows Parent Proxmox for lxc with proxmoxNodes', () => {
    renderModal({
      initial: { ...BASE, type: 'lxc' },
      proxmoxNodes: [{ id: 'px1', label: 'PVE-01' }],
    })
    expect(screen.getByText('Parent Proxmox')).toBeDefined()
  })

  it('hides Parent Proxmox for server type', () => {
    renderModal({ initial: BASE, proxmoxNodes: [{ id: 'px1', label: 'PVE-01' }] })
    expect(screen.queryByText('Parent Proxmox')).toBeNull()
  })

  it('hides Parent Proxmox for vm when no proxmoxNodes', () => {
    renderModal({ initial: { ...BASE, type: 'vm' } })
    expect(screen.queryByText('Parent Proxmox')).toBeNull()
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

  // ── Hardware section ──────────────────────────────────────────────────

  it('renders Hardware toggle button', () => {
    renderModal()
    expect(screen.getByText('Hardware')).toBeDefined()
  })

  it('hardware fields are hidden by default', () => {
    renderModal()
    expect(screen.queryByPlaceholderText('e.g. Intel Xeon E5-2680')).toBeNull()
  })

  it('expands hardware fields on toggle click', () => {
    renderModal()
    fireEvent.click(screen.getByText('Hardware'))
    expect(screen.getByPlaceholderText('e.g. Intel Xeon E5-2680')).toBeDefined()
    expect(screen.getByPlaceholderText('e.g. 8')).toBeDefined()
    expect(screen.getByPlaceholderText('e.g. 32')).toBeDefined()
    expect(screen.getByPlaceholderText('e.g. 500')).toBeDefined()
  })

  it('auto-expands when initial has hardware data', () => {
    renderModal({ initial: { ...BASE, cpu_count: 8, ram_gb: 32 } })
    expect(screen.getByPlaceholderText('e.g. Intel Xeon E5-2680')).toBeDefined()
  })

  it('pre-fills hardware fields from initial', () => {
    renderModal({ initial: { ...BASE, cpu_model: 'Intel i5', cpu_count: 4, ram_gb: 16, disk_gb: 500 } })
    expect((screen.getByPlaceholderText('e.g. Intel Xeon E5-2680') as HTMLInputElement).value).toBe('Intel i5')
  })

  it('submits hardware fields when filled', () => {
    const { onSubmit } = renderModal()
    fireEvent.change(screen.getByPlaceholderText('My Server'), { target: { value: 'Homelab' } })
    fireEvent.click(screen.getByText('Hardware'))
    fireEvent.change(screen.getByPlaceholderText('e.g. Intel Xeon E5-2680'), { target: { value: 'Intel i7-12700K' } })
    fireEvent.change(screen.getByPlaceholderText('e.g. 8'), { target: { value: '12' } })
    fireEvent.change(screen.getByPlaceholderText('e.g. 32'), { target: { value: '64' } })
    fireEvent.change(screen.getByPlaceholderText('e.g. 500'), { target: { value: '2000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    const data = onSubmit.mock.calls[0][0] as Partial<NodeData>
    expect(data.cpu_model).toBe('Intel i7-12700K')
    expect(data.cpu_count).toBe(12)
    expect(data.ram_gb).toBe(64)
    expect(data.disk_gb).toBe(2000)
  })

  it('hides Hardware section for groupRect type', () => {
    renderModal({ initial: { type: 'groupRect' } })
    expect(screen.queryByText('Hardware')).toBeNull()
  })

  it('show_hardware toggle hidden when section is collapsed', () => {
    renderModal()
    expect(screen.queryByText('Show on node')).toBeNull()
  })

  it('show_hardware toggle appears when section is expanded', () => {
    renderModal()
    fireEvent.click(screen.getByText('Hardware'))
    expect(screen.getByText('Show on node')).toBeDefined()
  })

  it('show_hardware defaults to falsy', () => {
    const { onSubmit } = renderModal()
    fireEvent.change(screen.getByPlaceholderText('My Server'), { target: { value: 'Node' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(onSubmit.mock.calls[0][0].show_hardware).toBeFalsy()
  })

  it('toggling show_hardware sets it to true', () => {
    const { onSubmit } = renderModal()
    fireEvent.change(screen.getByPlaceholderText('My Server'), { target: { value: 'Node' } })
    fireEvent.click(screen.getByText('Hardware'))
    fireEvent.click(screen.getByRole('switch'))
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(onSubmit.mock.calls[0][0].show_hardware).toBe(true)
  })

  it('pre-fills show_hardware from initial', () => {
    const { onSubmit } = renderModal({ initial: { label: 'Node', show_hardware: true, cpu_count: 8 } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(onSubmit.mock.calls[0][0].show_hardware).toBe(true)
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

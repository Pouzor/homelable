/**
 * The Device Inventory picker in the node editor.
 *
 * A node draws one inventory row, and that row owns its facts — so two nodes on
 * one row are one device, edited twice. The link used to be decided silently
 * from the ip field, which merged two containers a user had only described by
 * their port (#475) and gave them no way back. It is a field here.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { NodeModal } from '../NodeModal'
import { scanApi } from '@/api/client'
import type { InventoryEntry, NodeData } from '@/types'

vi.mock('sonner', async () => (await import('@/test/mocks')).mockSonner())

vi.mock('@/api/client', () => ({
  scanApi: {
    pending: vi.fn(),
    createPending: vi.fn(),
  },
}))

// Shadcn's Select is a portal-driven listbox; a native <select> is what the
// rest of this modal's tests drive, so the options are assertable.
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

function makeDevice(over: Partial<InventoryEntry> = {}): InventoryEntry {
  return {
    id: 'dev-1',
    ip: '192.168.1.10',
    mac: null,
    hostname: 'nas.lan',
    os: null,
    services: [],
    suggested_type: null,
    status: 'approved',
    discovered_at: '2026-01-01T00:00:00Z',
    ...over,
  }
}

const BASE: Partial<NodeData> = {
  type: 'docker_container', label: 'gitea', ip: ':3001', check_method: 'ping', services: [],
}

/** The picker is the last <select> the modal renders. */
const devicePicker = () => {
  const all = screen.getAllByRole('combobox') as HTMLSelectElement[]
  return all[all.length - 1]
}

function renderModal(props: Partial<Parameters<typeof NodeModal>[0]> = {}) {
  const onSubmit = vi.fn()
  render(<NodeModal open onClose={vi.fn()} onSubmit={onSubmit} initial={BASE} title="Edit Node" {...props} />)
  return { onSubmit }
}

describe('NodeModal — device inventory link', () => {
  beforeEach(() => {
    vi.mocked(scanApi.pending).mockResolvedValue({ data: [] } as never)
    vi.mocked(scanApi.createPending).mockResolvedValue({ data: makeDevice() } as never)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('lists the inventory and names the row this node draws', async () => {
    vi.mocked(scanApi.pending).mockResolvedValue({
      data: [makeDevice({ id: 'dev-1', label: 'NoteShare' }), makeDevice({ id: 'dev-2', label: 'NAS' })],
    } as never)
    renderModal({ initial: { ...BASE, device_id: 'dev-2' } })

    expect(await screen.findByRole('option', { name: /NoteShare/ })).toBeInTheDocument()
    expect(devicePicker().value).toBe('dev-2')
  })

  it('offers "not linked yet" only while the node has no row', async () => {
    vi.mocked(scanApi.pending).mockResolvedValue({ data: [makeDevice()] } as never)
    const { unmount } = render(
      <NodeModal open onClose={vi.fn()} onSubmit={vi.fn()} initial={BASE} />,
    )
    expect(await screen.findByRole('option', { name: 'Not linked yet' })).toBeInTheDocument()
    unmount()

    render(
      <NodeModal open onClose={vi.fn()} onSubmit={vi.fn()} initial={{ ...BASE, device_id: 'dev-1' }} />,
    )
    await waitFor(() => expect(scanApi.pending).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('option', { name: 'Not linked yet' })).not.toBeInTheDocument()
  })

  it('points the node at the device picked, and shows the facts it will display', async () => {
    vi.mocked(scanApi.pending).mockResolvedValue({
      data: [makeDevice({ id: 'dev-2', label: 'NAS', ip: '192.168.1.50', hostname: 'nas.lan' })],
    } as never)
    const { onSubmit } = renderModal()
    await screen.findByRole('option', { name: /NAS/ })

    fireEvent.change(devicePicker(), { target: { value: 'dev-2' } })

    // The addresses on screen belong to the row now, not to what the node had:
    // saving a device you can see and reloading into another one is the bug.
    expect(screen.getByPlaceholderText('192.168.1.x, 2001:db8::1')).toHaveValue('192.168.1.50')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ device_id: 'dev-2', ip: '192.168.1.50', label: 'NAS' }),
    )
  })

  it('leaves rack-created gear out — it is a mount, not a host', async () => {
    vi.mocked(scanApi.pending).mockResolvedValue({
      data: [
        makeDevice({ id: 'dev-1', label: 'Patch panel', discovery_source: 'rack' }),
        makeDevice({ id: 'dev-2', label: 'Shelf', discovery_sources: ['rack'] }),
        makeDevice({ id: 'dev-3', label: 'NAS' }),
      ],
    } as never)
    renderModal()

    expect(await screen.findByRole('option', { name: /NAS/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Patch panel/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Shelf/ })).not.toBeInTheDocument()
  })

  it('creates a separate row on demand, forcing past the address already taken', async () => {
    vi.mocked(scanApi.createPending).mockResolvedValue({
      data: makeDevice({ id: 'dev-new', label: 'gitea' }),
    } as never)
    const { onSubmit } = renderModal()
    await waitFor(() => expect(scanApi.pending).toHaveBeenCalled())

    fireEvent.change(devicePicker(), { target: { value: '__new__' } })

    await waitFor(() => expect(scanApi.createPending).toHaveBeenCalled())
    // Without `force` the new row folds straight back into the one this node is
    // trying to leave, and nothing is separated.
    expect(vi.mocked(scanApi.createPending).mock.calls[0][0]).toMatchObject({
      force: true,
      label: 'gitea',
      ip: ':3001',
    })
    await waitFor(() => expect(devicePicker().value).toBe('dev-new'))

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ device_id: 'dev-new' }))
  })

  it('keeps the node on its row when the inventory cannot be loaded', async () => {
    vi.mocked(scanApi.pending).mockRejectedValue(new Error('offline'))
    const { onSubmit } = renderModal({ initial: { ...BASE, device_id: 'dev-7' } })
    await waitFor(() => expect(scanApi.pending).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ device_id: 'dev-7' }))
  })

  it('is absent for canvas furniture, which describes no device', async () => {
    render(
      <NodeModal
        open
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        initial={{ type: 'text', label: 'A note' }}
      />,
    )
    await waitFor(() => expect(scanApi.pending).not.toHaveBeenCalled())
    expect(screen.queryByText(/The inventory row this node draws/)).not.toBeInTheDocument()
  })
})

describe('NodeModal — device inventory link (standalone)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
  })

  it('is absent without a backend — there is no inventory to point at', async () => {
    vi.stubEnv('VITE_STANDALONE', 'true')
    vi.resetModules()
    const { NodeModal: NM } = await import('../NodeModal')
    const { scanApi: api } = await import('@/api/client')
    vi.mocked(api.pending).mockResolvedValue({ data: [] } as never)

    render(<NM open onClose={vi.fn()} onSubmit={vi.fn()} initial={BASE} />)

    expect(screen.queryByText(/The inventory row this node draws/)).not.toBeInTheDocument()
    expect(api.pending).not.toHaveBeenCalled()
  })
})

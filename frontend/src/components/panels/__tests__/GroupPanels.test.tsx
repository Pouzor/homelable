import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DetailPanel } from '../DetailPanel'
import * as canvasStore from '@/stores/canvasStore'
import { TooltipProvider } from '@/components/ui/tooltip'

vi.mock('@/stores/canvasStore')
vi.mock('@/utils/serviceUrl', () => ({ getServiceUrl: () => null }))

function makeNode(id: string, overrides = {}) {
  return {
    id,
    type: 'server',
    position: { x: 0, y: 0 },
    data: { label: id, type: 'server', status: 'online', services: [] },
    ...overrides,
  }
}

function makeGroupNode(id = 'g1', label = 'My Group', showBorder = true) {
  return {
    id,
    type: 'group',
    position: { x: 76, y: 52 },
    data: {
      label,
      type: 'group',
      status: 'unknown',
      services: [],
      custom_colors: { show_border: showBorder },
    },
  }
}

const mockStore = {
  nodes: [],
  selectedNodeId: null,
  selectedNodeIds: [],
  setSelectedNode: vi.fn(),
  deleteNode: vi.fn(),
  updateNode: vi.fn(),
  snapshotHistory: vi.fn(),
  createGroup: vi.fn(),
  ungroup: vi.fn(),
  removeFromGroup: vi.fn(),
}

function setupStore(overrides = {}) {
  vi.mocked(canvasStore.useCanvasStore).mockReturnValue({
    ...mockStore,
    ...overrides,
  } as unknown as ReturnType<typeof canvasStore.useCanvasStore>)
}

function renderPanel() {
  return render(
    <TooltipProvider>
      <DetailPanel onEdit={vi.fn()} />
    </TooltipProvider>,
  )
}

describe('MultiSelectPanel', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders multi-select panel when 2+ nodes selected', () => {
    const n1 = makeNode('n1', { data: { label: 'Router', type: 'router', status: 'online', services: [] } })
    const n2 = makeNode('n2', { data: { label: 'Switch', type: 'switch', status: 'offline', services: [] } })
    setupStore({
      nodes: [n1, n2],
      selectedNodeId: null,
      selectedNodeIds: ['n1', 'n2'],
    })
    renderPanel()
    expect(screen.getByText('2 nodes selected')).toBeDefined()
  })

  it('lists selected node labels in multi-select panel', () => {
    const n1 = makeNode('n1', { data: { label: 'My Router', type: 'router', status: 'online', services: [] } })
    const n2 = makeNode('n2', { data: { label: 'My NAS', type: 'nas', status: 'unknown', services: [] } })
    setupStore({ nodes: [n1, n2], selectedNodeId: null, selectedNodeIds: ['n1', 'n2'] })
    renderPanel()
    expect(screen.getByText('My Router')).toBeDefined()
    expect(screen.getByText('My NAS')).toBeDefined()
  })

  it('shows Create Group button', () => {
    const n1 = makeNode('n1')
    const n2 = makeNode('n2')
    setupStore({ nodes: [n1, n2], selectedNodeId: null, selectedNodeIds: ['n1', 'n2'] })
    renderPanel()
    expect(screen.getByRole('button', { name: /create group/i })).toBeDefined()
  })

  it('shows name input when Create Group is clicked', async () => {
    const n1 = makeNode('n1')
    const n2 = makeNode('n2')
    setupStore({ nodes: [n1, n2], selectedNodeId: null, selectedNodeIds: ['n1', 'n2'] })
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: /create group/i }))
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/group name/i)).toBeDefined()
    })
  })

  it('calls createGroup with selected ids and entered name', async () => {
    const createGroup = vi.fn()
    const n1 = makeNode('n1')
    const n2 = makeNode('n2')
    setupStore({ nodes: [n1, n2], selectedNodeId: null, selectedNodeIds: ['n1', 'n2'], createGroup })
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: /create group/i }))
    const input = await screen.findByPlaceholderText(/group name/i)
    fireEvent.change(input, { target: { value: 'DMZ' } })
    fireEvent.click(screen.getByRole('button', { name: /^create group$/i }))
    expect(createGroup).toHaveBeenCalledWith(['n1', 'n2'], 'DMZ')
  })

  it('uses default name "Group" when input is empty', async () => {
    const createGroup = vi.fn()
    const n1 = makeNode('n1')
    const n2 = makeNode('n2')
    setupStore({ nodes: [n1, n2], selectedNodeId: null, selectedNodeIds: ['n1', 'n2'], createGroup })
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: /create group/i }))
    await screen.findByPlaceholderText(/group name/i)
    fireEvent.click(screen.getByRole('button', { name: /^create group$/i }))
    expect(createGroup).toHaveBeenCalledWith(['n1', 'n2'], 'Group')
  })

  it('includes groupRect (zone) nodes in multi-select count', () => {
    const n1 = makeNode('n1')
    const gr = makeNode('gr1', { data: { label: 'Zone', type: 'groupRect', status: 'unknown', services: [] } })
    setupStore({ nodes: [n1, gr], selectedNodeId: null, selectedNodeIds: ['n1', 'gr1'] })
    renderPanel()
    // groupRect included → 2 nodes selected → multi-select panel shown
    expect(screen.getByText('2 nodes selected')).toBeDefined()
  })
})

describe('GroupDetailPanel', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders group name and members heading', () => {
    const group = makeGroupNode()
    const child = makeNode('c1', { parentId: 'g1', data: { label: 'Router', type: 'router', status: 'online', services: [] } })
    setupStore({ nodes: [group, child], selectedNodeId: 'g1', selectedNodeIds: ['g1'] })
    renderPanel()
    expect(screen.getByText('My Group')).toBeDefined()
    expect(screen.getByText('Members')).toBeDefined()
  })

  it('lists children with their labels', () => {
    const group = makeGroupNode()
    const c1 = makeNode('c1', { parentId: 'g1', data: { label: 'My Router', type: 'router', status: 'online', services: [] } })
    const c2 = makeNode('c2', { parentId: 'g1', data: { label: 'My NAS', type: 'nas', status: 'offline', services: [] } })
    setupStore({ nodes: [group, c1, c2], selectedNodeId: 'g1', selectedNodeIds: ['g1'] })
    renderPanel()
    expect(screen.getByText('My Router')).toBeDefined()
    expect(screen.getByText('My NAS')).toBeDefined()
  })

  it('shows online/offline count in status summary', () => {
    const group = makeGroupNode()
    const c1 = makeNode('c1', { parentId: 'g1', data: { label: 'A', type: 'server', status: 'online', services: [] } })
    const c2 = makeNode('c2', { parentId: 'g1', data: { label: 'B', type: 'server', status: 'offline', services: [] } })
    setupStore({ nodes: [group, c1, c2], selectedNodeId: 'g1', selectedNodeIds: ['g1'] })
    renderPanel()
    expect(screen.getByText(/1 online/)).toBeDefined()
    expect(screen.getByText(/1 offline/)).toBeDefined()
  })

  it('shows Ungroup button', () => {
    const group = makeGroupNode()
    setupStore({ nodes: [group], selectedNodeId: 'g1', selectedNodeIds: ['g1'] })
    renderPanel()
    expect(screen.getByRole('button', { name: /ungroup/i })).toBeDefined()
  })

  it('calls ungroup after confirm', () => {
    const ungroup = vi.fn()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const group = makeGroupNode()
    setupStore({ nodes: [group], selectedNodeId: 'g1', selectedNodeIds: ['g1'], ungroup })
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: /ungroup/i }))
    expect(ungroup).toHaveBeenCalledWith('g1')
  })

  it('does not call ungroup when confirm is cancelled', () => {
    const ungroup = vi.fn()
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const group = makeGroupNode()
    setupStore({ nodes: [group], selectedNodeId: 'g1', selectedNodeIds: ['g1'], ungroup })
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: /ungroup/i }))
    expect(ungroup).not.toHaveBeenCalled()
  })

  it('shows "Hide border & title" when show_border is true', () => {
    const group = makeGroupNode('g1', 'G', true)
    setupStore({ nodes: [group], selectedNodeId: 'g1', selectedNodeIds: ['g1'] })
    renderPanel()
    expect(screen.getByText(/hide border/i)).toBeDefined()
  })

  it('shows "Show border & title" when show_border is false', () => {
    const group = makeGroupNode('g1', 'G', false)
    setupStore({ nodes: [group], selectedNodeId: 'g1', selectedNodeIds: ['g1'] })
    renderPanel()
    expect(screen.getByText(/show border/i)).toBeDefined()
  })

  it('calls updateNode to toggle show_border off', () => {
    const updateNode = vi.fn()
    const group = makeGroupNode('g1', 'G', true)
    setupStore({ nodes: [group], selectedNodeId: 'g1', selectedNodeIds: ['g1'], updateNode })
    renderPanel()
    fireEvent.click(screen.getByText(/hide border/i))
    expect(updateNode).toHaveBeenCalledWith('g1', expect.objectContaining({
      custom_colors: expect.objectContaining({ show_border: false }),
    }))
  })

  it('calls setSelectedNode when a child node is clicked', () => {
    const setSelectedNode = vi.fn()
    const group = makeGroupNode()
    const child = makeNode('c1', { parentId: 'g1', data: { label: 'Child Node Alpha', type: 'server', status: 'online', services: [] } })
    setupStore({ nodes: [group, child], selectedNodeId: 'g1', selectedNodeIds: ['g1'], setSelectedNode })
    renderPanel()
    fireEvent.click(screen.getByText('Child Node Alpha'))
    expect(setSelectedNode).toHaveBeenCalledWith('c1')
  })

  it('removes a child from the group via the remove button', () => {
    const removeFromGroup = vi.fn()
    const snapshotHistory = vi.fn()
    const group = makeGroupNode()
    const child = makeNode('c1', { parentId: 'g1', data: { label: 'Router', type: 'router', status: 'online', services: [] } })
    setupStore({ nodes: [group, child], selectedNodeId: 'g1', selectedNodeIds: ['g1'], removeFromGroup, snapshotHistory })
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: /remove router from group/i }))
    expect(removeFromGroup).toHaveBeenCalledWith('g1', 'c1')
    expect(snapshotHistory).toHaveBeenCalled()
  })

  it('renders the existing group description from notes', () => {
    const group = makeGroupNode()
    group.data = { ...group.data, notes: 'Critical DMZ hosts' } as typeof group.data
    setupStore({ nodes: [group], selectedNodeId: 'g1', selectedNodeIds: ['g1'] })
    renderPanel()
    expect((screen.getByLabelText('Description') as HTMLTextAreaElement).value).toBe('Critical DMZ hosts')
  })

  it('commits the description to the store on each change (so Ctrl+S captures it)', () => {
    const updateNode = vi.fn()
    const group = makeGroupNode()
    setupStore({ nodes: [group], selectedNodeId: 'g1', selectedNodeIds: ['g1'], updateNode })
    renderPanel()
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'New notes' } })
    expect(updateNode).toHaveBeenCalledWith('g1', { notes: 'New notes' })
  })

  it('snapshots history once at the start of an edit, not on every keystroke', () => {
    const updateNode = vi.fn()
    const snapshotHistory = vi.fn()
    const group = makeGroupNode()
    setupStore({ nodes: [group], selectedNodeId: 'g1', selectedNodeIds: ['g1'], updateNode, snapshotHistory })
    renderPanel()
    const textarea = screen.getByLabelText('Description')
    fireEvent.change(textarea, { target: { value: 'a' } })
    fireEvent.change(textarea, { target: { value: 'ab' } })
    fireEvent.change(textarea, { target: { value: 'abc' } })
    expect(snapshotHistory).toHaveBeenCalledTimes(1)
  })
})

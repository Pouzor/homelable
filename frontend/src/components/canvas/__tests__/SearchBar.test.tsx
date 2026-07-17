import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SearchBar } from '../SearchBar'
import * as canvasStore from '@/stores/canvasStore'

vi.mock('@/stores/canvasStore')

vi.mock('@xyflow/react', () => ({
  useReactFlow: () => ({ setCenter: vi.fn() }),
}))

function makeNode(id: string, overrides = {}) {
  return {
    id,
    type: 'server',
    position: { x: 0, y: 0 },
    data: { label: id, type: 'server', status: 'online', services: [], ip: null, hostname: null },
    ...overrides,
  }
}

function setupStore(nodes: unknown[] = []) {
  vi.mocked(canvasStore.useCanvasStore).mockReturnValue({
    nodes,
    setSelectedNode: vi.fn(),
  } as unknown as ReturnType<typeof canvasStore.useCanvasStore>)
}

function openSearch() {
  fireEvent.keyDown(window, { key: 'f', ctrlKey: true })
}

describe('SearchBar', () => {
  beforeEach(() => {
    setupStore([])
    vi.clearAllMocks()
  })

  it('is hidden by default', () => {
    render(<SearchBar />)
    expect(screen.queryByPlaceholderText(/search/i)).toBeNull()
  })

  it('opens on Ctrl+F', () => {
    render(<SearchBar />)
    openSearch()
    expect(screen.getByPlaceholderText(/search/i)).toBeDefined()
  })

  it('opens on Cmd+F', () => {
    render(<SearchBar />)
    fireEvent.keyDown(window, { key: 'f', metaKey: true })
    expect(screen.getByPlaceholderText(/search/i)).toBeDefined()
  })

  it('closes on Escape', () => {
    render(<SearchBar />)
    openSearch()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByPlaceholderText(/search/i)).toBeNull()
  })

  it('closes when X button is clicked', () => {
    render(<SearchBar />)
    openSearch()
    fireEvent.click(screen.getByLabelText('Close search'))
    expect(screen.queryByPlaceholderText(/search/i)).toBeNull()
  })

  it('filters by label', () => {
    setupStore([
      makeNode('n1', { data: { label: 'My Router', type: 'router', status: 'online', services: [], ip: null, hostname: null } }),
      makeNode('n2', { data: { label: 'My NAS', type: 'nas', status: 'online', services: [], ip: null, hostname: null } }),
    ])
    render(<SearchBar />)
    openSearch()
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'router' } })
    expect(screen.getByText('My Router')).toBeDefined()
    expect(screen.queryByText('My NAS')).toBeNull()
  })

  it('filters by IP', () => {
    setupStore([
      makeNode('n1', { data: { label: 'Server A', type: 'server', status: 'online', services: [], ip: '192.168.1.10', hostname: null } }),
      makeNode('n2', { data: { label: 'Server B', type: 'server', status: 'online', services: [], ip: '10.0.0.1', hostname: null } }),
    ])
    render(<SearchBar />)
    openSearch()
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: '192.168' } })
    expect(screen.getByText('Server A')).toBeDefined()
    expect(screen.queryByText('Server B')).toBeNull()
  })

  it('filters by service name', () => {
    setupStore([
      makeNode('n1', { data: { label: 'Web Server', type: 'server', status: 'online', services: [{ service_name: 'nginx', port: 80, protocol: 'tcp' }], ip: null, hostname: null } }),
      makeNode('n2', { data: { label: 'DB Server', type: 'server', status: 'online', services: [{ service_name: 'mysql', port: 3306, protocol: 'tcp' }], ip: null, hostname: null } }),
    ])
    render(<SearchBar />)
    openSearch()
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'nginx' } })
    expect(screen.getByText('Web Server')).toBeDefined()
    expect(screen.queryByText('DB Server')).toBeNull()
  })

  it('filters by notes', () => {
    setupStore([
      makeNode('n1', { data: { label: 'Server A', type: 'server', status: 'online', services: [], ip: null, hostname: null, notes: 'backup target every night' } }),
      makeNode('n2', { data: { label: 'Server B', type: 'server', status: 'online', services: [], ip: null, hostname: null, notes: 'primary web host' } }),
    ])
    render(<SearchBar />)
    openSearch()
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'backup' } })
    expect(screen.getByText('Server A')).toBeDefined()
    expect(screen.queryByText('Server B')).toBeNull()
  })

  it('filters by visible property key or value', () => {
    setupStore([
      makeNode('n1', { data: { label: 'Server A', type: 'server', status: 'online', services: [], ip: null, hostname: null, properties: [{ key: 'rack', value: 'B12', icon: null, visible: true }] } }),
      makeNode('n2', { data: { label: 'Server B', type: 'server', status: 'online', services: [], ip: null, hostname: null, properties: [{ key: 'rack', value: 'A01', icon: null, visible: true }] } }),
    ])
    render(<SearchBar />)
    openSearch()
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'b12' } })
    expect(screen.getByText('Server A')).toBeDefined()
    expect(screen.queryByText('Server B')).toBeNull()
  })

  it('ignores hidden properties', () => {
    setupStore([
      makeNode('n1', { data: { label: 'Server A', type: 'server', status: 'online', services: [], ip: null, hostname: null, properties: [{ key: 'secret', value: 'hidden-val', icon: null, visible: false }] } }),
    ])
    render(<SearchBar />)
    openSearch()
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'hidden-val' } })
    expect(screen.queryByText('Server A')).toBeNull()
  })

  it('shows the matched value alongside the node label', () => {
    setupStore([
      makeNode('n1', { data: { label: 'Server A', type: 'server', status: 'online', services: [], ip: null, hostname: null, properties: [{ key: 'rack', value: 'B12', icon: null, visible: true }] } }),
    ])
    render(<SearchBar />)
    openSearch()
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'b12' } })
    expect(screen.getByText('rack = B12')).toBeDefined()
  })

  it('excludes groupRect nodes from results', () => {
    setupStore([
      makeNode('gr1', { data: { label: 'DMZ Zone', type: 'groupRect', status: 'unknown', services: [], ip: null, hostname: null } }),
    ])
    render(<SearchBar />)
    openSearch()
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'dmz' } })
    expect(screen.queryByText('DMZ Zone')).toBeNull()
  })

  it('shows no-results message when query has no matches', () => {
    render(<SearchBar />)
    openSearch()
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'zzznomatch' } })
    expect(screen.getByText(/no results/i)).toBeDefined()
  })

  it('calls setSelectedNode when a result is clicked', () => {
    const setSelectedNode = vi.fn()
    vi.mocked(canvasStore.useCanvasStore).mockReturnValue({
      nodes: [makeNode('n1', { data: { label: 'My Server', type: 'server', status: 'online', services: [], ip: null, hostname: null } })],
      setSelectedNode,
    } as unknown as ReturnType<typeof canvasStore.useCanvasStore>)
    render(<SearchBar />)
    openSearch()
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'my server' } })
    fireEvent.click(screen.getByText('My Server'))
    expect(setSelectedNode).toHaveBeenCalledWith('n1')
  })

  it('shows result count', () => {
    setupStore([
      makeNode('n1', { data: { label: 'Alpha', type: 'server', status: 'online', services: [], ip: null, hostname: null } }),
      makeNode('n2', { data: { label: 'Beta', type: 'server', status: 'online', services: [], ip: null, hostname: null } }),
    ])
    render(<SearchBar />)
    openSearch()
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'a' } })
    expect(screen.getByText(/2 results/i)).toBeDefined()
  })
})

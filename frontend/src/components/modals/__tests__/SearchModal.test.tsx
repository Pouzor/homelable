import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SearchModal } from '../SearchModal'
import { useCanvasStore } from '@/stores/canvasStore'
import type { Node } from '@xyflow/react'
import type { NodeData } from '@/types'

const mockFitView = vi.fn()
vi.mock('@xyflow/react', () => ({
  useReactFlow: () => ({ fitView: mockFitView }),
}))

function makeNode(id: string, overrides: Partial<NodeData> = {}): Node<NodeData> {
  return {
    id,
    type: overrides.type ?? 'server',
    position: { x: 0, y: 0 },
    data: {
      label: id,
      type: overrides.type ?? 'server',
      status: 'unknown',
      services: [],
      ...overrides,
    },
  }
}

describe('SearchModal', () => {
  beforeEach(() => {
    useCanvasStore.setState({ nodes: [], edges: [], selectedNodeId: null })
    mockFitView.mockReset()
  })

  it('renders nothing when closed', () => {
    render(<SearchModal open={false} onClose={vi.fn()} />)
    expect(screen.queryByPlaceholderText(/search nodes/i)).toBeNull()
  })

  it('renders search input when open', () => {
    render(<SearchModal open onClose={vi.fn()} />)
    expect(screen.getByPlaceholderText(/search nodes/i)).toBeDefined()
  })

  it('shows "Type to search" hint when query is empty', () => {
    render(<SearchModal open onClose={vi.fn()} />)
    expect(screen.getByText(/type to search/i)).toBeDefined()
  })

  it('shows no results message when query has no matches', () => {
    useCanvasStore.setState({ nodes: [makeNode('router', { label: 'Router' })] })
    render(<SearchModal open onClose={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText(/search nodes/i), { target: { value: 'zzz' } })
    expect(screen.getByText(/no nodes match/i)).toBeDefined()
  })

  it('filters nodes by label', () => {
    useCanvasStore.setState({
      nodes: [makeNode('n1', { label: 'My Router' }), makeNode('n2', { label: 'NAS Server' })],
    })
    render(<SearchModal open onClose={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText(/search nodes/i), { target: { value: 'router' } })
    expect(screen.getByText('My Router')).toBeDefined()
    expect(screen.queryByText('NAS Server')).toBeNull()
  })

  it('filters nodes by IP', () => {
    useCanvasStore.setState({
      nodes: [
        makeNode('n1', { label: 'Box A', ip: '192.168.1.10' }),
        makeNode('n2', { label: 'Box B', ip: '10.0.0.1' }),
      ],
    })
    render(<SearchModal open onClose={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText(/search nodes/i), { target: { value: '192.168' } })
    expect(screen.getByText('Box A')).toBeDefined()
    expect(screen.queryByText('Box B')).toBeNull()
  })

  it('filters nodes by hostname', () => {
    useCanvasStore.setState({
      nodes: [
        makeNode('n1', { label: 'A', hostname: 'pve.local' }),
        makeNode('n2', { label: 'B', hostname: 'nas.local' }),
      ],
    })
    render(<SearchModal open onClose={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText(/search nodes/i), { target: { value: 'pve' } })
    expect(screen.getByText('A')).toBeDefined()
    expect(screen.queryByText('B')).toBeNull()
  })

  it('excludes groupRect nodes from results', () => {
    useCanvasStore.setState({
      nodes: [
        makeNode('n1', { label: 'Server', type: 'server' }),
        makeNode('g1', { label: 'Zone A', type: 'groupRect' }),
      ],
    })
    render(<SearchModal open onClose={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText(/search nodes/i), { target: { value: 'zone' } })
    expect(screen.getByText(/no nodes match/i)).toBeDefined()
  })

  it('limits results to 8 nodes', () => {
    useCanvasStore.setState({
      nodes: Array.from({ length: 12 }, (_, i) => makeNode(`n${i}`, { label: `Server ${i}` })),
    })
    render(<SearchModal open onClose={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText(/search nodes/i), { target: { value: 'server' } })
    const items = screen.getAllByText(/Server \d/)
    expect(items).toHaveLength(8)
  })

  it('selects node and closes on result click', () => {
    const onClose = vi.fn()
    useCanvasStore.setState({ nodes: [makeNode('n1', { label: 'Proxmox' })] })
    render(<SearchModal open onClose={onClose} />)
    fireEvent.change(screen.getByPlaceholderText(/search nodes/i), { target: { value: 'prox' } })
    fireEvent.click(screen.getByText('Proxmox'))
    expect(useCanvasStore.getState().selectedNodeId).toBe('n1')
    expect(mockFitView).toHaveBeenCalledWith(expect.objectContaining({ nodes: [{ id: 'n1' }] }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('selects first result and closes on Enter key', () => {
    const onClose = vi.fn()
    useCanvasStore.setState({ nodes: [makeNode('n1', { label: 'Switch' })] })
    render(<SearchModal open onClose={onClose} />)
    const input = screen.getByPlaceholderText(/search nodes/i)
    fireEvent.change(input, { target: { value: 'switch' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(useCanvasStore.getState().selectedNodeId).toBe('n1')
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('closes on Escape key', () => {
    const onClose = vi.fn()
    render(<SearchModal open onClose={onClose} />)
    fireEvent.keyDown(screen.getByPlaceholderText(/search nodes/i), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('closes when clicking backdrop', () => {
    const onClose = vi.fn()
    render(<SearchModal open onClose={onClose} />)
    // The backdrop is the fixed inset div — clicking it fires onClose
    const backdrop = document.querySelector('.fixed.inset-0') as HTMLElement
    fireEvent.click(backdrop)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('does not close when clicking inside the search box', () => {
    const onClose = vi.fn()
    render(<SearchModal open onClose={onClose} />)
    fireEvent.click(screen.getByPlaceholderText(/search nodes/i))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('search is case-insensitive', () => {
    useCanvasStore.setState({ nodes: [makeNode('n1', { label: 'My NAS' })] })
    render(<SearchModal open onClose={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText(/search nodes/i), { target: { value: 'MY NAS' } })
    expect(screen.getByText('My NAS')).toBeDefined()
  })
})

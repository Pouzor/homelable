import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DetailPanel } from '../DetailPanel'
import * as canvasStore from '@/stores/canvasStore'
import type { NodeData } from '@/types'
import type { Node } from '@xyflow/react'

vi.mock('@/stores/canvasStore')

function makeNode(data: Partial<NodeData>): Node<NodeData> {
  return {
    id: 'n1',
    type: data.type ?? 'server',
    position: { x: 0, y: 0 },
    data: {
      label: 'Test Node',
      type: 'server',
      status: 'online',
      services: [],
      ...data,
    },
  }
}

function setupStore(nodeData: Partial<NodeData> = {}) {
  vi.mocked(canvasStore.useCanvasStore).mockReturnValue({
    nodes: [makeNode(nodeData)],
    selectedNodeId: 'n1',
    setSelectedNode: vi.fn(),
    deleteNode: vi.fn(),
    updateNode: vi.fn(),
    snapshotHistory: vi.fn(),
  } as unknown as ReturnType<typeof canvasStore.useCanvasStore>)
}

describe('DetailPanel', () => {
  beforeEach(() => {
    vi.mocked(canvasStore.useCanvasStore).mockReturnValue({
      nodes: [],
      selectedNodeId: null,
      setSelectedNode: vi.fn(),
      deleteNode: vi.fn(),
      updateNode: vi.fn(),
      snapshotHistory: vi.fn(),
    } as unknown as ReturnType<typeof canvasStore.useCanvasStore>)
  })

  it('renders nothing when no node is selected', () => {
    const { container } = render(<DetailPanel onEdit={vi.fn()} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders node label and status', () => {
    setupStore({ label: 'My Server', status: 'online' })
    render(<DetailPanel onEdit={vi.fn()} />)
    expect(screen.getByText('My Server')).toBeDefined()
    expect(screen.getByText('online')).toBeDefined()
  })

  it('renders nothing for groupRect nodes', () => {
    setupStore({ type: 'groupRect', label: 'Zone' })
    const { container } = render(<DetailPanel onEdit={vi.fn()} />)
    expect(container.firstChild).toBeNull()
  })

  describe('Hardware section', () => {
    it('does not render hardware section when no hardware data', () => {
      setupStore({ label: 'Server' })
      render(<DetailPanel onEdit={vi.fn()} />)
      expect(screen.queryByText('Hardware')).toBeNull()
    })

    it('renders hardware section when cpu_count is set', () => {
      setupStore({ cpu_count: 8 })
      render(<DetailPanel onEdit={vi.fn()} />)
      expect(screen.getByText('Hardware')).toBeDefined()
      expect(screen.getByText('8')).toBeDefined()
    })

    it('renders cpu_model', () => {
      setupStore({ cpu_model: 'Intel Xeon E5-2680' })
      render(<DetailPanel onEdit={vi.fn()} />)
      expect(screen.getByText('Intel Xeon E5-2680')).toBeDefined()
    })

    it('formats ram_gb in GB', () => {
      setupStore({ ram_gb: 32 })
      render(<DetailPanel onEdit={vi.fn()} />)
      expect(screen.getByText('32 GB')).toBeDefined()
    })

    it('formats ram_gb >= 1024 as TB', () => {
      setupStore({ ram_gb: 2048 })
      render(<DetailPanel onEdit={vi.fn()} />)
      expect(screen.getByText('2 TB')).toBeDefined()
    })

    it('formats disk_gb in GB', () => {
      setupStore({ disk_gb: 500 })
      render(<DetailPanel onEdit={vi.fn()} />)
      expect(screen.getByText('500 GB')).toBeDefined()
    })

    it('formats disk_gb >= 1024 as TB', () => {
      setupStore({ disk_gb: 1536 })
      render(<DetailPanel onEdit={vi.fn()} />)
      expect(screen.getByText('1.5 TB')).toBeDefined()
    })

    it('renders all hardware fields together', () => {
      setupStore({ cpu_count: 16, cpu_model: 'AMD EPYC', ram_gb: 128, disk_gb: 4096 })
      render(<DetailPanel onEdit={vi.fn()} />)
      expect(screen.getByText('Hardware')).toBeDefined()
      expect(screen.getByText('AMD EPYC')).toBeDefined()
      expect(screen.getByText('16')).toBeDefined()
      expect(screen.getByText('128 GB')).toBeDefined()
      expect(screen.getByText('4 TB')).toBeDefined()
    })
  })

  describe('Panel actions', () => {
    it('calls setSelectedNode(null) when close button is clicked', () => {
      const setSelectedNode = vi.fn()
      vi.mocked(canvasStore.useCanvasStore).mockReturnValue({
        nodes: [makeNode({})],
        selectedNodeId: 'n1',
        setSelectedNode,
        deleteNode: vi.fn(),
        updateNode: vi.fn(),
        snapshotHistory: vi.fn(),
      } as unknown as ReturnType<typeof canvasStore.useCanvasStore>)
      render(<DetailPanel onEdit={vi.fn()} />)
      fireEvent.click(screen.getByLabelText('Close panel'))
      expect(setSelectedNode).toHaveBeenCalledWith(null)
    })

    it('calls onEdit with node id when Edit button is clicked', () => {
      setupStore({})
      const onEdit = vi.fn()
      render(<DetailPanel onEdit={onEdit} />)
      fireEvent.click(screen.getByRole('button', { name: /edit/i }))
      expect(onEdit).toHaveBeenCalledWith('n1')
    })

    it('calls snapshotHistory then deleteNode when delete confirmed', () => {
      const deleteNode = vi.fn()
      const snapshotHistory = vi.fn()
      vi.mocked(canvasStore.useCanvasStore).mockReturnValue({
        nodes: [makeNode({ label: 'My Server' })],
        selectedNodeId: 'n1',
        setSelectedNode: vi.fn(),
        deleteNode,
        updateNode: vi.fn(),
        snapshotHistory,
      } as unknown as ReturnType<typeof canvasStore.useCanvasStore>)
      vi.spyOn(window, 'confirm').mockReturnValue(true)
      render(<DetailPanel onEdit={vi.fn()} />)
      fireEvent.click(screen.getByLabelText('Delete node'))
      expect(snapshotHistory).toHaveBeenCalledOnce()
      expect(deleteNode).toHaveBeenCalledWith('n1')
    })

    it('does not call deleteNode or snapshotHistory when delete is cancelled', () => {
      const deleteNode = vi.fn()
      const snapshotHistory = vi.fn()
      vi.mocked(canvasStore.useCanvasStore).mockReturnValue({
        nodes: [makeNode({})],
        selectedNodeId: 'n1',
        setSelectedNode: vi.fn(),
        deleteNode,
        updateNode: vi.fn(),
        snapshotHistory,
      } as unknown as ReturnType<typeof canvasStore.useCanvasStore>)
      vi.spyOn(window, 'confirm').mockReturnValue(false)
      render(<DetailPanel onEdit={vi.fn()} />)
      fireEvent.click(screen.getByLabelText('Delete node'))
      expect(snapshotHistory).not.toHaveBeenCalled()
      expect(deleteNode).not.toHaveBeenCalled()
    })
  })

  describe('Services — add/remove', () => {
    it('shows add form when Add is clicked', () => {
      setupStore({})
      render(<DetailPanel onEdit={vi.fn()} />)
      fireEvent.click(screen.getByText('Add'))
      expect(screen.getByPlaceholderText('Service name')).toBeDefined()
    })

    it('calls updateNode with new service on Add confirm', () => {
      const updateNode = vi.fn()
      vi.mocked(canvasStore.useCanvasStore).mockReturnValue({
        nodes: [makeNode({})],
        selectedNodeId: 'n1',
        setSelectedNode: vi.fn(),
        deleteNode: vi.fn(),
        updateNode,
        snapshotHistory: vi.fn(),
      } as unknown as ReturnType<typeof canvasStore.useCanvasStore>)
      render(<DetailPanel onEdit={vi.fn()} />)
      fireEvent.click(screen.getByText('Add'))
      fireEvent.change(screen.getByPlaceholderText('Service name'), { target: { value: 'nginx' } })
      fireEvent.change(screen.getByPlaceholderText('Port'), { target: { value: '80' } })
      // Two "Add" buttons exist: the header toggle and the form confirm — pick the form's
      const addButtons = screen.getAllByRole('button', { name: 'Add' })
      fireEvent.click(addButtons[addButtons.length - 1])
      expect(updateNode).toHaveBeenCalledOnce()
      expect(updateNode.mock.calls[0][1].services[0]).toMatchObject({ service_name: 'nginx', port: 80, protocol: 'tcp' })
    })

    it('calls updateNode without the removed service when X is clicked', () => {
      const updateNode = vi.fn()
      const svc = { port: 80, protocol: 'tcp' as const, service_name: 'nginx' }
      vi.mocked(canvasStore.useCanvasStore).mockReturnValue({
        nodes: [makeNode({ services: [svc] })],
        selectedNodeId: 'n1',
        setSelectedNode: vi.fn(),
        deleteNode: vi.fn(),
        updateNode,
        snapshotHistory: vi.fn(),
      } as unknown as ReturnType<typeof canvasStore.useCanvasStore>)
      render(<DetailPanel onEdit={vi.fn()} />)
      fireEvent.click(screen.getByTitle('Remove service'))
      expect(updateNode).toHaveBeenCalledOnce()
      expect(updateNode.mock.calls[0][1].services).toHaveLength(0)
    })

    it('does not crash when data.services is undefined', () => {
      vi.mocked(canvasStore.useCanvasStore).mockReturnValue({
        nodes: [makeNode({ services: undefined as unknown as [] })],
        selectedNodeId: 'n1',
        setSelectedNode: vi.fn(),
        deleteNode: vi.fn(),
        updateNode: vi.fn(),
        snapshotHistory: vi.fn(),
      } as unknown as ReturnType<typeof canvasStore.useCanvasStore>)
      expect(() => render(<DetailPanel onEdit={vi.fn()} />)).not.toThrow()
    })
  })

  describe('Services — edit', () => {
    const svc = { port: 80, protocol: 'tcp' as const, service_name: 'nginx' }

    it('shows edit form pre-filled when pencil is clicked', () => {
      setupStore({ services: [svc] })
      render(<DetailPanel onEdit={vi.fn()} />)
      // Hover to reveal edit button (fireEvent.mouseOver isn't needed — opacity is CSS only)
      const editBtn = screen.getByTitle('Edit service')
      fireEvent.click(editBtn)
      const nameInput = screen.getByPlaceholderText('Service name') as HTMLInputElement
      expect(nameInput.value).toBe('nginx')
      const portInput = screen.getByPlaceholderText('Port') as HTMLInputElement
      expect(portInput.value).toBe('80')
    })

    it('calls updateNode with updated values on Save', () => {
      const updateNode = vi.fn()
      vi.mocked(canvasStore.useCanvasStore).mockReturnValue({
        nodes: [makeNode({ services: [svc] })],
        selectedNodeId: 'n1',
        setSelectedNode: vi.fn(),
        deleteNode: vi.fn(),
        updateNode,
        snapshotHistory: vi.fn(),
      } as unknown as ReturnType<typeof canvasStore.useCanvasStore>)

      render(<DetailPanel onEdit={vi.fn()} />)
      fireEvent.click(screen.getByTitle('Edit service'))

      const nameInput = screen.getByPlaceholderText('Service name')
      fireEvent.change(nameInput, { target: { value: 'apache' } })
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))

      expect(updateNode).toHaveBeenCalledOnce()
      expect(updateNode.mock.calls[0][1].services[0].service_name).toBe('apache')
      expect(updateNode.mock.calls[0][1].services[0].port).toBe(80)
    })

    it('cancels edit without updating', () => {
      const updateNode = vi.fn()
      vi.mocked(canvasStore.useCanvasStore).mockReturnValue({
        nodes: [makeNode({ services: [svc] })],
        selectedNodeId: 'n1',
        setSelectedNode: vi.fn(),
        deleteNode: vi.fn(),
        updateNode,
        snapshotHistory: vi.fn(),
      } as unknown as ReturnType<typeof canvasStore.useCanvasStore>)

      render(<DetailPanel onEdit={vi.fn()} />)
      fireEvent.click(screen.getByTitle('Edit service'))
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

      expect(updateNode).not.toHaveBeenCalled()
      expect(screen.getByText('nginx')).toBeDefined()
    })
  })
})

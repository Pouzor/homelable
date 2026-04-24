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
    selectedNodeIds: [],
    setSelectedNode: vi.fn(),
    deleteNode: vi.fn(),
    updateNode: vi.fn(),
    snapshotHistory: vi.fn(),
    createGroup: vi.fn(),
    ungroup: vi.fn(),
  } as unknown as ReturnType<typeof canvasStore.useCanvasStore>)
}

describe('DetailPanel', () => {
  beforeEach(() => {
    vi.mocked(canvasStore.useCanvasStore).mockReturnValue({
      nodes: [],
      selectedNodeId: null,
      selectedNodeIds: [],
      setSelectedNode: vi.fn(),
      deleteNode: vi.fn(),
      updateNode: vi.fn(),
      snapshotHistory: vi.fn(),
      createGroup: vi.fn(),
      ungroup: vi.fn(),
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

  describe('Properties section', () => {
    it('renders empty state when no properties', () => {
      setupStore({ properties: [] })
      render(<DetailPanel onEdit={vi.fn()} />)
      expect(screen.getByText(/No properties/)).toBeDefined()
    })

    it('renders properties with key and value', () => {
      setupStore({
        properties: [
          { key: 'CPU Model', value: 'i7-12700K', icon: 'Cpu', visible: true },
          { key: 'RAM', value: '32 GB', icon: 'MemoryStick', visible: false },
        ],
      })
      render(<DetailPanel onEdit={vi.fn()} />)
      expect(screen.getByText('CPU Model')).toBeDefined()
      // Value is rendered with a middle-dot prefix: "· 32 GB"
      expect(screen.getByText(/32 GB/)).toBeDefined()
    })

    it('shows Properties count when properties exist', () => {
      setupStore({
        properties: [
          { key: 'CPU Model', value: 'i7', icon: null, visible: true },
          { key: 'RAM', value: '16 GB', icon: null, visible: true },
        ],
      })
      render(<DetailPanel onEdit={vi.fn()} />)
      expect(screen.getByText('Properties (2)')).toBeDefined()
    })

    it('shows add form when Add is clicked', () => {
      setupStore({ properties: [] })
      render(<DetailPanel onEdit={vi.fn()} />)
      // There are multiple "Add" buttons (services + properties) — find the one after "Properties"
      const addButtons = screen.getAllByText('Add')
      fireEvent.click(addButtons[0]) // first Add = properties (rendered above services)
      expect(screen.getByPlaceholderText('Label (e.g. CPU Model)')).toBeDefined()
    })

    it('calls updateNode with new property on Add confirm', () => {
      const updateNode = vi.fn()
      vi.mocked(canvasStore.useCanvasStore).mockReturnValue({
        nodes: [makeNode({ properties: [] })],
        selectedNodeId: 'n1',
        selectedNodeIds: [],
        setSelectedNode: vi.fn(),
        deleteNode: vi.fn(),
        updateNode,
        snapshotHistory: vi.fn(),
        createGroup: vi.fn(),
        ungroup: vi.fn(),
      } as unknown as ReturnType<typeof canvasStore.useCanvasStore>)

      render(<DetailPanel onEdit={vi.fn()} />)
      const addButtons = screen.getAllByText('Add')
      fireEvent.click(addButtons[0]) // first Add = properties
      // Form is now open — fill key and value
      fireEvent.change(screen.getByPlaceholderText('Label (e.g. CPU Model)'), { target: { value: 'GPU' } })
      fireEvent.change(screen.getByPlaceholderText('Value (e.g. i7-12700K)'), { target: { value: 'RTX 4090' } })
      // The PropertyForm confirm button is labeled "Add" — use the form's confirm button
      fireEvent.keyDown(screen.getByPlaceholderText('Value (e.g. i7-12700K)'), { key: 'Enter' })
      expect(updateNode).toHaveBeenCalledOnce()
      const [, payload] = updateNode.mock.calls[0]
      expect(payload.properties[0]).toMatchObject({ key: 'GPU', value: 'RTX 4090', visible: true })
    })

    it('calls updateNode with toggled visibility when eye button is clicked', () => {
      const updateNode = vi.fn()
      vi.mocked(canvasStore.useCanvasStore).mockReturnValue({
        nodes: [makeNode({ properties: [{ key: 'RAM', value: '32 GB', icon: 'MemoryStick', visible: true }] })],
        selectedNodeId: 'n1',
        selectedNodeIds: [],
        setSelectedNode: vi.fn(),
        deleteNode: vi.fn(),
        updateNode,
        snapshotHistory: vi.fn(),
        createGroup: vi.fn(),
        ungroup: vi.fn(),
      } as unknown as ReturnType<typeof canvasStore.useCanvasStore>)

      render(<DetailPanel onEdit={vi.fn()} />)
      fireEvent.click(screen.getByTitle('Hide on node'))
      expect(updateNode).toHaveBeenCalledOnce()
      const [, payload] = updateNode.mock.calls[0]
      expect(payload.properties[0].visible).toBe(false)
    })

    it('calls updateNode without the property when remove button is clicked', () => {
      const updateNode = vi.fn()
      vi.mocked(canvasStore.useCanvasStore).mockReturnValue({
        nodes: [makeNode({ properties: [{ key: 'GPU', value: 'RTX 4090', icon: null, visible: true }] })],
        selectedNodeId: 'n1',
        selectedNodeIds: [],
        setSelectedNode: vi.fn(),
        deleteNode: vi.fn(),
        updateNode,
        snapshotHistory: vi.fn(),
        createGroup: vi.fn(),
        ungroup: vi.fn(),
      } as unknown as ReturnType<typeof canvasStore.useCanvasStore>)

      render(<DetailPanel onEdit={vi.fn()} />)
      fireEvent.click(screen.getByTitle('Remove property'))
      expect(updateNode).toHaveBeenCalledOnce()
      const [, payload] = updateNode.mock.calls[0]
      expect(payload.properties).toHaveLength(0)
    })

    it('does not submit add form when key is empty', () => {
      const updateNode = vi.fn()
      vi.mocked(canvasStore.useCanvasStore).mockReturnValue({
        nodes: [makeNode({ properties: [] })],
        selectedNodeId: 'n1',
        selectedNodeIds: [],
        setSelectedNode: vi.fn(),
        deleteNode: vi.fn(),
        updateNode,
        snapshotHistory: vi.fn(),
        createGroup: vi.fn(),
        ungroup: vi.fn(),
      } as unknown as ReturnType<typeof canvasStore.useCanvasStore>)

      render(<DetailPanel onEdit={vi.fn()} />)
      const addButtons = screen.getAllByText('Add')
      fireEvent.click(addButtons[0])
      // Only fill value, leave key empty
      fireEvent.change(screen.getByPlaceholderText('Value (e.g. i7-12700K)'), { target: { value: 'some value' } })
      const confirmButtons = screen.getAllByRole('button', { name: 'Add' })
      fireEvent.click(confirmButtons[confirmButtons.length - 1])
      expect(updateNode).not.toHaveBeenCalled()
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
      // Two "Add" buttons: first = properties, second = services
      const addButtons = screen.getAllByText('Add')
      fireEvent.click(addButtons[addButtons.length - 1])
      expect(screen.getByPlaceholderText('Service name')).toBeDefined()
    })

    it('calls updateNode with new service on Add confirm', () => {
      const updateNode = vi.fn()
      vi.mocked(canvasStore.useCanvasStore).mockReturnValue({
        nodes: [makeNode({})],
        selectedNodeId: 'n1',
        selectedNodeIds: [],
        setSelectedNode: vi.fn(),
        deleteNode: vi.fn(),
        updateNode,
        snapshotHistory: vi.fn(),
        createGroup: vi.fn(),
        ungroup: vi.fn(),
      } as unknown as ReturnType<typeof canvasStore.useCanvasStore>)
      render(<DetailPanel onEdit={vi.fn()} />)
      // Two "Add" header buttons: first = properties, second = services
      const addHeaders = screen.getAllByText('Add')
      fireEvent.click(addHeaders[addHeaders.length - 1])
      fireEvent.change(screen.getByPlaceholderText('Service name'), { target: { value: 'nginx' } })
      fireEvent.change(screen.getByPlaceholderText('Port'), { target: { value: '80' } })
      fireEvent.change(screen.getByPlaceholderText('Path (/admin)'), { target: { value: '/admin' } })
      fireEvent.keyDown(screen.getByPlaceholderText('Port'), { key: 'Enter' })
      expect(updateNode).toHaveBeenCalledOnce()
      expect(updateNode.mock.calls[0][1].services[0]).toMatchObject({ service_name: 'nginx', port: 80, protocol: 'tcp', path: '/admin' })
    })

    it('allows adding a service without a port', () => {
      const updateNode = vi.fn()
      vi.mocked(canvasStore.useCanvasStore).mockReturnValue({
        nodes: [makeNode({ ip: '192.168.1.10:8080' })],
        selectedNodeId: 'n1',
        selectedNodeIds: [],
        setSelectedNode: vi.fn(),
        deleteNode: vi.fn(),
        updateNode,
        snapshotHistory: vi.fn(),
        createGroup: vi.fn(),
        ungroup: vi.fn(),
      } as unknown as ReturnType<typeof canvasStore.useCanvasStore>)
      render(<DetailPanel onEdit={vi.fn()} />)
      const addHeaders = screen.getAllByText('Add')
      fireEvent.click(addHeaders[addHeaders.length - 1])
      fireEvent.change(screen.getByPlaceholderText('Service name'), { target: { value: 'health' } })
      fireEvent.change(screen.getByPlaceholderText('Path (/admin)'), { target: { value: 'healthz' } })
      fireEvent.click(screen.getAllByRole('button', { name: 'Add' }).at(-1) as HTMLButtonElement)

      expect(updateNode).toHaveBeenCalledOnce()
      expect(updateNode.mock.calls[0][1].services[0]).toMatchObject({ service_name: 'health', protocol: 'tcp', path: 'healthz' })
      expect(updateNode.mock.calls[0][1].services[0].port).toBeUndefined()
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
      setupStore({ services: [{ ...svc, path: '/admin' }] })
      render(<DetailPanel onEdit={vi.fn()} />)
      // Hover to reveal edit button (fireEvent.mouseOver isn't needed — opacity is CSS only)
      const editBtn = screen.getByTitle('Edit service')
      fireEvent.click(editBtn)
      const nameInput = screen.getByPlaceholderText('Service name') as HTMLInputElement
      expect(nameInput.value).toBe('nginx')
      const portInput = screen.getByPlaceholderText('Port') as HTMLInputElement
      expect(portInput.value).toBe('80')
      const pathInput = screen.getByPlaceholderText('Path (/admin)') as HTMLInputElement
      expect(pathInput.value).toBe('/admin')
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
      fireEvent.change(screen.getByPlaceholderText('Path (/admin)'), { target: { value: '/admin' } })
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))

      expect(updateNode).toHaveBeenCalledOnce()
      expect(updateNode.mock.calls[0][1].services[0].service_name).toBe('apache')
      expect(updateNode.mock.calls[0][1].services[0].port).toBe(80)
      expect(updateNode.mock.calls[0][1].services[0].path).toBe('/admin')
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

  describe('IP Address — clickable link', () => {
    it('renders a link for a single IP', () => {
      setupStore({ ip: '192.168.1.10' })
      render(<DetailPanel onEdit={vi.fn()} />)
      const link = screen.getByRole('link', { name: /192\.168\.1\.10/ })
      expect(link).toBeDefined()
      expect(link.getAttribute('href')).toBe('http://192.168.1.10')
      expect(link.getAttribute('target')).toBe('_blank')
    })

    it('renders no IP link when ip is absent', () => {
      setupStore({ ip: undefined })
      render(<DetailPanel onEdit={vi.fn()} />)
      expect(screen.queryByText('IP Address')).toBeNull()
    })

    it('uses primary IP as href for comma-separated IPs', () => {
      setupStore({ ip: '192.168.1.10, 192.168.1.11' })
      render(<DetailPanel onEdit={vi.fn()} />)
      const link = screen.getByRole('link', { name: /192\.168\.1\.10/ })
      expect(link.getAttribute('href')).toBe('http://192.168.1.10')
    })

    it('displays full comma-separated IP string as link text', () => {
      setupStore({ ip: '192.168.1.10, 192.168.1.11' })
      render(<DetailPanel onEdit={vi.fn()} />)
      expect(screen.getByText(/192\.168\.1\.10, 192\.168\.1\.11/)).toBeDefined()
    })
  })

  describe('ServiceBadge rendering', () => {
    it('renders service name and port/protocol label', () => {
      setupStore({ services: [{ port: 8080, protocol: 'tcp', service_name: 'nginx', path: '' }] })
      render(<DetailPanel onEdit={vi.fn()} />)
      expect(screen.getByText('nginx')).toBeDefined()
      expect(screen.getByText('8080/tcp')).toBeDefined()
    })

    it('renders path label when path is set', () => {
      setupStore({ services: [{ port: 80, protocol: 'tcp', service_name: 'web', path: '/admin' }] })
      render(<DetailPanel onEdit={vi.fn()} />)
      expect(screen.getByText('/admin')).toBeDefined()
    })

    it('renders no path text when path is empty', () => {
      setupStore({ services: [{ port: 80, protocol: 'tcp', service_name: 'web', path: '' }] })
      render(<DetailPanel onEdit={vi.fn()} />)
      expect(screen.queryByText('/')).toBeNull()
    })

    it('renders port/protocol omitted when port is absent', () => {
      setupStore({ services: [{ protocol: 'tcp', service_name: 'health', path: '' }] })
      render(<DetailPanel onEdit={vi.fn()} />)
      expect(screen.getByText('health')).toBeDefined()
      expect(screen.queryByText(/\/tcp/)).toBeNull()
    })

    it('renders service name as link when ip and port are set', () => {
      setupStore({ ip: '192.168.1.10', services: [{ port: 8080, protocol: 'tcp', service_name: 'nginx', path: '' }] })
      render(<DetailPanel onEdit={vi.fn()} />)
      const link = screen.getByRole('link', { name: 'nginx' })
      expect(link.getAttribute('href')).toContain('192.168.1.10')
      expect(link.getAttribute('target')).toBe('_blank')
    })

    it('renders service name as plain text when no url can be built', () => {
      setupStore({ ip: undefined, services: [{ protocol: 'tcp', service_name: 'health', path: '' }] })
      render(<DetailPanel onEdit={vi.fn()} />)
      expect(screen.getByText('health').tagName).not.toBe('A')
    })
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ZigbeeImportModal } from '../ZigbeeImportModal'

vi.mock('@/api/client', () => ({
  zigbeeApi: {
    testConnection: vi.fn(),
    importNetwork: vi.fn(),
    importToPending: vi.fn(),
  },
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))

import { zigbeeApi } from '@/api/client'
import { toast } from 'sonner'

const defaultProps = {
  open: true,
  onClose: vi.fn(),
  onAddToCanvas: vi.fn(),
}

const sampleNodes = [
  {
    id: '0x0000',
    label: 'Coordinator',
    type: 'zigbee_coordinator' as const,
    ieee_address: '0x0000',
    friendly_name: 'Coordinator',
    device_type: 'Coordinator',
    model: null,
    vendor: null,
    lqi: null,
    parent_id: null,
  },
  {
    id: '0x0001',
    label: 'router_1',
    type: 'zigbee_router' as const,
    ieee_address: '0x0001',
    friendly_name: 'router_1',
    device_type: 'Router',
    model: 'CC2530',
    vendor: 'TI',
    lqi: 200,
    parent_id: '0x0000',
  },
]

describe('ZigbeeImportModal', () => {
  beforeEach(() => {
    vi.mocked(zigbeeApi.testConnection).mockReset()
    vi.mocked(zigbeeApi.importNetwork).mockReset()
    vi.mocked(zigbeeApi.importToPending).mockReset()
    vi.mocked(toast.success).mockReset()
    vi.mocked(toast.error).mockReset()
    vi.mocked(toast.info).mockReset()
    defaultProps.onClose.mockReset()
    defaultProps.onAddToCanvas.mockReset()
  })

  it('renders nothing when closed', () => {
    const { container } = render(<ZigbeeImportModal {...defaultProps} open={false} />)
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })

  it('renders the modal with form fields when open', () => {
    render(<ZigbeeImportModal {...defaultProps} />)
    expect(screen.getByText('Zigbee2MQTT Import')).toBeDefined()
    expect(screen.getByPlaceholderText('192.168.1.x or mqtt.local')).toBeDefined()
    expect(screen.getByPlaceholderText('1883')).toBeDefined()
    expect(screen.getByPlaceholderText('zigbee2mqtt')).toBeDefined()
  })

  it('shows error toast when testing connection without a host', async () => {
    render(<ZigbeeImportModal {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: /test connection/i }))
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Enter a broker hostname')
    })
    expect(zigbeeApi.testConnection).not.toHaveBeenCalled()
  })

  it('shows success status when connection test passes', async () => {
    vi.mocked(zigbeeApi.testConnection).mockResolvedValue({
      data: { connected: true, message: 'Connection successful' },
    } as never)

    render(<ZigbeeImportModal {...defaultProps} />)
    const hostInput = screen.getByPlaceholderText('192.168.1.x or mqtt.local')
    fireEvent.change(hostInput, { target: { value: '192.168.1.100' } })
    fireEvent.click(screen.getByRole('button', { name: /test connection/i }))

    await waitFor(() => {
      expect(screen.getByText('Connection successful')).toBeDefined()
    })
  })

  it('shows failure status when connection test fails', async () => {
    vi.mocked(zigbeeApi.testConnection).mockResolvedValue({
      data: { connected: false, message: 'Connection refused' },
    } as never)

    render(<ZigbeeImportModal {...defaultProps} />)
    const hostInput = screen.getByPlaceholderText('192.168.1.x or mqtt.local')
    fireEvent.change(hostInput, { target: { value: '10.0.0.1' } })
    fireEvent.click(screen.getByRole('button', { name: /test connection/i }))

    await waitFor(() => {
      expect(screen.getByText('Connection refused')).toBeDefined()
    })
  })

  const selectCanvasMode = () => {
    fireEvent.click(screen.getByRole('radio', { name: /canvas directly/i }))
  }

  it('fetches devices and renders them grouped by type', async () => {
    vi.mocked(zigbeeApi.importNetwork).mockResolvedValue({
      data: { nodes: sampleNodes, edges: [], device_count: 2 },
    } as never)

    render(<ZigbeeImportModal {...defaultProps} />)
    selectCanvasMode()
    const hostInput = screen.getByPlaceholderText('192.168.1.x or mqtt.local')
    fireEvent.change(hostInput, { target: { value: '192.168.1.100' } })
    fireEvent.click(screen.getByRole('button', { name: /fetch devices/i }))

    await waitFor(() => {
      expect(screen.getByText('Coordinator')).toBeDefined()
      expect(screen.getByText('router_1')).toBeDefined()
    })
    expect(toast.success).toHaveBeenCalledWith('Found 2 devices')
  })

  it('shows info toast when no devices found', async () => {
    vi.mocked(zigbeeApi.importNetwork).mockResolvedValue({
      data: { nodes: [], edges: [], device_count: 0 },
    } as never)

    render(<ZigbeeImportModal {...defaultProps} />)
    selectCanvasMode()
    const hostInput = screen.getByPlaceholderText('192.168.1.x or mqtt.local')
    fireEvent.change(hostInput, { target: { value: '192.168.1.100' } })
    fireEvent.click(screen.getByRole('button', { name: /fetch devices/i }))

    await waitFor(() => {
      expect(toast.info).toHaveBeenCalledWith('No Zigbee devices found in the network map')
    })
  })

  it('calls onAddToCanvas with selected devices and closes modal', async () => {
    vi.mocked(zigbeeApi.importNetwork).mockResolvedValue({
      data: { nodes: sampleNodes, edges: [{ source: '0x0000', target: '0x0001' }], device_count: 2 },
    } as never)

    render(<ZigbeeImportModal {...defaultProps} />)
    selectCanvasMode()
    const hostInput = screen.getByPlaceholderText('192.168.1.x or mqtt.local')
    fireEvent.change(hostInput, { target: { value: '192.168.1.100' } })
    fireEvent.click(screen.getByRole('button', { name: /fetch devices/i }))

    await waitFor(() => screen.getByText('Coordinator'))

    // Click "Add N to Canvas" button
    const addBtn = screen.getByRole('button', { name: /add.*canvas/i })
    fireEvent.click(addBtn)

    await waitFor(() => {
      expect(defaultProps.onAddToCanvas).toHaveBeenCalledOnce()
      expect(defaultProps.onClose).toHaveBeenCalledOnce()
    })
  })

  it('calls onClose when Cancel is clicked', () => {
    render(<ZigbeeImportModal {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(defaultProps.onClose).toHaveBeenCalledOnce()
  })

  it('imports to pending by default and notifies parent', async () => {
    vi.mocked(zigbeeApi.importToPending).mockResolvedValue({
      data: {
        id: 'run-1',
        status: 'running',
        kind: 'zigbee',
        ranges: ['192.168.1.100:1883'],
        devices_found: 0,
        started_at: '2026-01-01T00:00:00Z',
        finished_at: null,
        error: null,
      },
    } as never)
    const onPendingImported = vi.fn()

    render(<ZigbeeImportModal {...defaultProps} onPendingImported={onPendingImported} />)
    const hostInput = screen.getByPlaceholderText('192.168.1.x or mqtt.local')
    fireEvent.change(hostInput, { target: { value: '192.168.1.100' } })
    fireEvent.click(screen.getByRole('button', { name: /import to pending/i }))

    await waitFor(() => {
      expect(zigbeeApi.importToPending).toHaveBeenCalled()
      expect(onPendingImported).toHaveBeenCalled()
      expect(defaultProps.onClose).toHaveBeenCalled()
    })
    expect(zigbeeApi.importNetwork).not.toHaveBeenCalled()
  })

  it('switching to canvas mode calls importNetwork and not importToPending', async () => {
    vi.mocked(zigbeeApi.importNetwork).mockResolvedValue({
      data: { nodes: sampleNodes, edges: [], device_count: 2 },
    } as never)

    render(<ZigbeeImportModal {...defaultProps} />)
    fireEvent.click(screen.getByRole('radio', { name: /canvas directly/i }))
    const hostInput = screen.getByPlaceholderText('192.168.1.x or mqtt.local')
    fireEvent.change(hostInput, { target: { value: '192.168.1.100' } })
    fireEvent.click(screen.getByRole('button', { name: /fetch devices/i }))

    await waitFor(() => expect(zigbeeApi.importNetwork).toHaveBeenCalled())
    expect(zigbeeApi.importToPending).not.toHaveBeenCalled()
  })
})

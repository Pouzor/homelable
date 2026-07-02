import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ZwaveImportModal } from '../ZwaveImportModal'

vi.mock('@/api/client', () => ({
  zwaveApi: {
    testConnection: vi.fn(),
    importNetwork: vi.fn(),
    importToPending: vi.fn(),
  },
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))

import { zwaveApi } from '@/api/client'
import { toast } from 'sonner'

const defaultProps = {
  open: true,
  onClose: vi.fn(),
  onAddToCanvas: vi.fn(),
}

const sampleNodes = [
  {
    id: 'zwave-0xh-1',
    label: 'Controller',
    type: 'zwave_coordinator' as const,
    ieee_address: 'zwave-0xh-1',
    friendly_name: 'Controller',
    device_type: 'Controller',
    model: null,
    vendor: null,
    lqi: null,
    parent_id: null,
  },
  {
    id: 'zwave-0xh-2',
    label: 'Wall Plug',
    type: 'zwave_router' as const,
    ieee_address: 'zwave-0xh-2',
    friendly_name: 'Wall Plug',
    device_type: 'Router',
    model: 'ZW100',
    vendor: 'Aeotec',
    lqi: null,
    parent_id: 'zwave-0xh-1',
  },
]

describe('ZwaveImportModal', () => {
  beforeEach(() => {
    vi.mocked(zwaveApi.testConnection).mockReset()
    vi.mocked(zwaveApi.importNetwork).mockReset()
    vi.mocked(zwaveApi.importToPending).mockReset()
    vi.mocked(toast.success).mockReset()
    vi.mocked(toast.error).mockReset()
    vi.mocked(toast.info).mockReset()
    defaultProps.onClose.mockReset()
    defaultProps.onAddToCanvas.mockReset()
  })

  it('renders nothing when closed', () => {
    const { container } = render(<ZwaveImportModal {...defaultProps} open={false} />)
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })

  it('renders the modal with prefix and gateway fields when open', () => {
    render(<ZwaveImportModal {...defaultProps} />)
    expect(screen.getByText('Z-Wave Import')).toBeDefined()
    expect(screen.getByPlaceholderText('zwave')).toBeDefined()
    expect(screen.getByPlaceholderText('zwavejs2mqtt')).toBeDefined()
  })

  it('shows error toast when testing connection without a host', async () => {
    render(<ZwaveImportModal {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: /test connection/i }))
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Enter a broker hostname')
    })
    expect(zwaveApi.testConnection).not.toHaveBeenCalled()
  })

  it('shows success status when connection test passes', async () => {
    vi.mocked(zwaveApi.testConnection).mockResolvedValue({
      data: { connected: true, message: 'Connection successful' },
    } as never)

    render(<ZwaveImportModal {...defaultProps} />)
    fireEvent.change(screen.getByPlaceholderText('192.168.1.x or mqtt.local'), {
      target: { value: '192.168.1.100' },
    })
    fireEvent.click(screen.getByRole('button', { name: /test connection/i }))

    await waitFor(() => {
      expect(screen.getByText('Connection successful')).toBeDefined()
    })
  })

  const selectCanvasMode = () => {
    fireEvent.click(screen.getByRole('radio', { name: /canvas directly/i }))
  }

  it('fetches devices and renders them grouped by type', async () => {
    vi.mocked(zwaveApi.importNetwork).mockResolvedValue({
      data: { nodes: sampleNodes, edges: [], device_count: 2 },
    } as never)

    render(<ZwaveImportModal {...defaultProps} />)
    selectCanvasMode()
    fireEvent.change(screen.getByPlaceholderText('192.168.1.x or mqtt.local'), {
      target: { value: '192.168.1.100' },
    })
    fireEvent.click(screen.getByRole('button', { name: /fetch devices/i }))

    await waitFor(() => {
      expect(screen.getByText('Controller')).toBeDefined()
      expect(screen.getByText('Wall Plug')).toBeDefined()
    })
    expect(toast.success).toHaveBeenCalledWith('Found 2 devices')
  })

  it('passes prefix and gateway_name to importNetwork', async () => {
    vi.mocked(zwaveApi.importNetwork).mockResolvedValue({
      data: { nodes: [], edges: [], device_count: 0 },
    } as never)

    render(<ZwaveImportModal {...defaultProps} />)
    selectCanvasMode()
    fireEvent.change(screen.getByPlaceholderText('192.168.1.x or mqtt.local'), {
      target: { value: '10.0.0.5' },
    })
    fireEvent.change(screen.getByPlaceholderText('zwave'), { target: { value: 'myzw' } })
    fireEvent.change(screen.getByPlaceholderText('zwavejs2mqtt'), { target: { value: 'gw1' } })
    fireEvent.click(screen.getByRole('button', { name: /fetch devices/i }))

    await waitFor(() => expect(zwaveApi.importNetwork).toHaveBeenCalled())
    const payload = vi.mocked(zwaveApi.importNetwork).mock.calls[0][0]
    expect(payload.prefix).toBe('myzw')
    expect(payload.gateway_name).toBe('gw1')
  })

  it('imports to pending by default and notifies parent', async () => {
    vi.mocked(zwaveApi.importToPending).mockResolvedValue({
      data: {
        id: 'run-1',
        status: 'running',
        kind: 'zwave',
        ranges: ['192.168.1.100:1883'],
        devices_found: 0,
        started_at: '2026-01-01T00:00:00Z',
        finished_at: null,
        error: null,
      },
    } as never)
    const onPendingImported = vi.fn()

    render(<ZwaveImportModal {...defaultProps} onPendingImported={onPendingImported} />)
    fireEvent.change(screen.getByPlaceholderText('192.168.1.x or mqtt.local'), {
      target: { value: '192.168.1.100' },
    })
    fireEvent.click(screen.getByRole('button', { name: /import to pending/i }))

    await waitFor(() => {
      expect(zwaveApi.importToPending).toHaveBeenCalled()
      expect(onPendingImported).toHaveBeenCalled()
      expect(defaultProps.onClose).toHaveBeenCalled()
    })
    expect(zwaveApi.importNetwork).not.toHaveBeenCalled()
  })

  it('calls onAddToCanvas with selected devices and closes modal', async () => {
    vi.mocked(zwaveApi.importNetwork).mockResolvedValue({
      data: { nodes: sampleNodes, edges: [{ source: 'zwave-0xh-1', target: 'zwave-0xh-2' }], device_count: 2 },
    } as never)

    render(<ZwaveImportModal {...defaultProps} />)
    selectCanvasMode()
    fireEvent.change(screen.getByPlaceholderText('192.168.1.x or mqtt.local'), {
      target: { value: '192.168.1.100' },
    })
    fireEvent.click(screen.getByRole('button', { name: /fetch devices/i }))

    await waitFor(() => screen.getByText('Controller'))

    fireEvent.click(screen.getByRole('button', { name: /add.*canvas/i }))

    await waitFor(() => {
      expect(defaultProps.onAddToCanvas).toHaveBeenCalledOnce()
      expect(defaultProps.onClose).toHaveBeenCalledOnce()
    })
  })

  it('calls onClose when Cancel is clicked', () => {
    render(<ZwaveImportModal {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(defaultProps.onClose).toHaveBeenCalledOnce()
  })
})

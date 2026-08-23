import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SynologyImportModal } from '../SynologyImportModal'

vi.mock('@/api/client', () => ({
  synologyApi: {
    testConnection: vi.fn(),
    importNetwork: vi.fn(),
    importToPending: vi.fn(),
  },
}))
vi.mock('sonner', async () => (await import('@/test/mocks')).mockSonner())

import { synologyApi } from '@/api/client'
import { toast } from 'sonner'

const defaultProps = {
  open: true,
  onClose: vi.fn(),
  onAddToCanvas: vi.fn(),
  onInventoryImported: vi.fn(),
}

const sampleNodes = [
  {
    id: 'syno-1230ABC', label: 'nas', type: 'nas' as const,
    ieee_address: 'syno-1230ABC', hostname: 'nas', ip: '192.168.1.20', status: 'online',
    ram_gb: 16, disk_gb: 32, vendor: 'Synology', model: 'DS1821+',
  },
]

describe('SynologyImportModal', () => {
  beforeEach(() => {
    vi.mocked(synologyApi.testConnection).mockReset()
    vi.mocked(synologyApi.importNetwork).mockReset()
    vi.mocked(synologyApi.importToPending).mockReset()
    vi.mocked(toast.success).mockReset()
    vi.mocked(toast.error).mockReset()
    vi.mocked(toast.info).mockReset()
    defaultProps.onClose.mockReset()
    defaultProps.onAddToCanvas.mockReset()
    defaultProps.onInventoryImported.mockReset()
  })

  it('renders nothing when closed', () => {
    const { container } = render(<SynologyImportModal {...defaultProps} open={false} />)
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })

  it('renders credential fields with a masked password input', () => {
    render(<SynologyImportModal {...defaultProps} />)
    expect(screen.getByText('Synology DSM Import')).toBeDefined()
    expect(screen.getByPlaceholderText('homelable')).toBeDefined()
    const secret = document.querySelector('input[type="password"]')
    expect(secret).not.toBeNull()
  })

  it('errors when testing without a host', async () => {
    render(<SynologyImportModal {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: /test connection/i }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Enter a Synology host'))
    expect(synologyApi.testConnection).not.toHaveBeenCalled()
  })

  it('shows connection message on successful test', async () => {
    vi.mocked(synologyApi.testConnection).mockResolvedValue({
      data: { connected: true, message: 'Connected to Synology DS1821+ DSM 7.2.1' },
    } as never)
    render(<SynologyImportModal {...defaultProps} />)
    fireEvent.change(screen.getByPlaceholderText('192.168.1.x or nas.local'), { target: { value: 'nas' } })
    fireEvent.click(screen.getByRole('button', { name: /test connection/i }))
    await waitFor(() => expect(screen.getByText('Connected to Synology DS1821+ DSM 7.2.1')).toBeDefined())
  })

  it('imports to pending by default and notifies parent', async () => {
    vi.mocked(synologyApi.importToPending).mockResolvedValue({
      data: { id: 'run-1', status: 'running', kind: 'synology', ranges: [], devices_found: 0, started_at: '', finished_at: null, error: null },
    } as never)
    render(<SynologyImportModal {...defaultProps} />)
    fireEvent.change(screen.getByPlaceholderText('192.168.1.x or nas.local'), { target: { value: 'nas' } })
    fireEvent.click(screen.getByRole('button', { name: /import to pending/i }))
    await waitFor(() => expect(synologyApi.importToPending).toHaveBeenCalled())
    expect(defaultProps.onInventoryImported).toHaveBeenCalled()
    expect(synologyApi.importNetwork).not.toHaveBeenCalled()
  })

  it('fetches inventory in canvas mode', async () => {
    vi.mocked(synologyApi.importNetwork).mockResolvedValue({
      data: { nodes: sampleNodes, device_count: 1 },
    } as never)
    render(<SynologyImportModal {...defaultProps} />)
    fireEvent.click(screen.getByRole('radio', { name: /canvas directly/i }))
    fireEvent.change(screen.getByPlaceholderText('192.168.1.x or nas.local'), { target: { value: 'nas' } })
    fireEvent.click(screen.getByRole('button', { name: /fetch inventory/i }))
    await waitFor(() => {
      expect(screen.getByText('nas')).toBeDefined()
    })
    expect(toast.success).toHaveBeenCalledWith('Found 1 device')
  })

  it('sends credentials from the form in the payload', async () => {
    vi.mocked(synologyApi.importNetwork).mockResolvedValue({
      data: { nodes: [], device_count: 0 },
    } as never)
    render(<SynologyImportModal {...defaultProps} />)
    fireEvent.click(screen.getByRole('radio', { name: /canvas directly/i }))
    fireEvent.change(screen.getByPlaceholderText('192.168.1.x or nas.local'), { target: { value: 'nas' } })
    fireEvent.change(screen.getByPlaceholderText('homelable'), { target: { value: 'hl' } })
    fireEvent.click(screen.getByRole('button', { name: /fetch inventory/i }))
    await waitFor(() => expect(synologyApi.importNetwork).toHaveBeenCalled())
    const payload = vi.mocked(synologyApi.importNetwork).mock.calls[0][0]
    expect(payload.username).toBe('hl')
    expect(payload.port).toBe(5001)
  })
})

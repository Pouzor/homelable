import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ProxmoxImportModal } from '../ProxmoxImportModal'

vi.mock('@/api/client', () => ({
  proxmoxApi: {
    testConnection: vi.fn(),
    importNetwork: vi.fn(),
    importToPending: vi.fn(),
  },
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))

import { proxmoxApi } from '@/api/client'
import { toast } from 'sonner'

const defaultProps = {
  open: true,
  onClose: vi.fn(),
  onAddToCanvas: vi.fn(),
  onPendingImported: vi.fn(),
}

const sampleNodes = [
  {
    id: 'pve-node-pve1', label: 'pve1', type: 'proxmox' as const,
    ieee_address: 'pve-node-pve1', hostname: 'pve1', ip: null, status: 'online',
    cpu_count: 8, ram_gb: 16, disk_gb: 500, vendor: 'Proxmox VE', model: null, parent_ieee: null,
  },
  {
    id: 'pve-pve1-101', label: 'web', type: 'vm' as const,
    ieee_address: 'pve-pve1-101', hostname: 'web', ip: '10.0.0.5', status: 'online',
    cpu_count: 2, ram_gb: 4, disk_gb: 32, vendor: 'Proxmox VE', model: 'QEMU', parent_ieee: 'pve-node-pve1',
  },
]

describe('ProxmoxImportModal', () => {
  beforeEach(() => {
    vi.mocked(proxmoxApi.testConnection).mockReset()
    vi.mocked(proxmoxApi.importNetwork).mockReset()
    vi.mocked(proxmoxApi.importToPending).mockReset()
    vi.mocked(toast.success).mockReset()
    vi.mocked(toast.error).mockReset()
    vi.mocked(toast.info).mockReset()
    defaultProps.onClose.mockReset()
    defaultProps.onAddToCanvas.mockReset()
    defaultProps.onPendingImported.mockReset()
  })

  it('renders nothing when closed', () => {
    const { container } = render(<ProxmoxImportModal {...defaultProps} open={false} />)
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })

  it('renders token fields with a masked secret input', () => {
    render(<ProxmoxImportModal {...defaultProps} />)
    expect(screen.getByText('Proxmox VE Import')).toBeDefined()
    expect(screen.getByPlaceholderText('user@pam!tokenname')).toBeDefined()
    const secret = document.querySelector('input[type="password"]')
    expect(secret).not.toBeNull()
  })

  it('errors when testing without a host', async () => {
    render(<ProxmoxImportModal {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: /test connection/i }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Enter a Proxmox host'))
    expect(proxmoxApi.testConnection).not.toHaveBeenCalled()
  })

  it('shows connection message on successful test', async () => {
    vi.mocked(proxmoxApi.testConnection).mockResolvedValue({
      data: { connected: true, message: 'Connected to Proxmox VE 8.2.2' },
    } as never)
    render(<ProxmoxImportModal {...defaultProps} />)
    fireEvent.change(screen.getByPlaceholderText('192.168.1.x or pve.local'), { target: { value: 'pve' } })
    fireEvent.click(screen.getByRole('button', { name: /test connection/i }))
    await waitFor(() => expect(screen.getByText('Connected to Proxmox VE 8.2.2')).toBeDefined())
  })

  it('imports to pending by default and notifies parent', async () => {
    vi.mocked(proxmoxApi.importToPending).mockResolvedValue({
      data: { id: 'run-1', status: 'running', kind: 'proxmox', ranges: [], devices_found: 0, started_at: '', finished_at: null, error: null },
    } as never)
    render(<ProxmoxImportModal {...defaultProps} />)
    fireEvent.change(screen.getByPlaceholderText('192.168.1.x or pve.local'), { target: { value: 'pve' } })
    fireEvent.click(screen.getByRole('button', { name: /import to pending/i }))
    await waitFor(() => expect(proxmoxApi.importToPending).toHaveBeenCalled())
    expect(defaultProps.onPendingImported).toHaveBeenCalled()
    expect(proxmoxApi.importNetwork).not.toHaveBeenCalled()
  })

  it('fetches inventory in canvas mode and groups by type', async () => {
    vi.mocked(proxmoxApi.importNetwork).mockResolvedValue({
      data: { nodes: sampleNodes, edges: [{ source: 'pve-node-pve1', target: 'pve-pve1-101' }], device_count: 2 },
    } as never)
    render(<ProxmoxImportModal {...defaultProps} />)
    fireEvent.click(screen.getByRole('radio', { name: /canvas directly/i }))
    fireEvent.change(screen.getByPlaceholderText('192.168.1.x or pve.local'), { target: { value: 'pve' } })
    fireEvent.click(screen.getByRole('button', { name: /fetch inventory/i }))
    await waitFor(() => {
      expect(screen.getByText('pve1')).toBeDefined()
      expect(screen.getByText('web')).toBeDefined()
    })
    expect(toast.success).toHaveBeenCalledWith('Found 2 devices')
  })

  it('sends the token from the form in the payload', async () => {
    vi.mocked(proxmoxApi.importNetwork).mockResolvedValue({
      data: { nodes: [], edges: [], device_count: 0 },
    } as never)
    render(<ProxmoxImportModal {...defaultProps} />)
    fireEvent.click(screen.getByRole('radio', { name: /canvas directly/i }))
    fireEvent.change(screen.getByPlaceholderText('192.168.1.x or pve.local'), { target: { value: 'pve' } })
    fireEvent.change(screen.getByPlaceholderText('user@pam!tokenname'), { target: { value: 'root@pam!hl' } })
    fireEvent.click(screen.getByRole('button', { name: /fetch inventory/i }))
    await waitFor(() => expect(proxmoxApi.importNetwork).toHaveBeenCalled())
    const payload = vi.mocked(proxmoxApi.importNetwork).mock.calls[0][0]
    expect(payload.token_id).toBe('root@pam!hl')
    expect(payload.port).toBe(8006)
  })
})

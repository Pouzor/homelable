import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { UnraidImportModal } from '../UnraidImportModal'

vi.mock('@/api/client', () => ({
  unraidApi: {
    testConnection: vi.fn(),
    importNetwork: vi.fn(),
    importToPending: vi.fn(),
  },
}))
vi.mock('sonner', async () => (await import('@/test/mocks')).mockSonner())

import { unraidApi } from '@/api/client'
import { toast } from 'sonner'

const defaultProps = {
  open: true,
  onClose: vi.fn(),
  onAddToCanvas: vi.fn(),
  onInventoryImported: vi.fn(),
}

const HOST_INPUT = '192.168.1.x or tower.local'

const sampleNodes = [
  {
    id: 'unraid-host-abc', label: 'Tower', type: 'docker_host' as const,
    ieee_address: 'unraid-host-abc', hostname: 'Tower', ip: '10.0.0.2', status: 'online',
    vendor: 'Unraid', model: 'MSI', parent_ieee: null,
  },
  {
    id: 'unraid-abc-ct-plex', label: 'plex', type: 'docker_container' as const,
    ieee_address: 'unraid-abc-ct-plex', hostname: 'plex', ip: null, status: 'online',
    vendor: 'Docker', model: 'linuxserver/plex', parent_ieee: 'unraid-host-abc',
  },
]
const sampleEdges = [{ source: 'unraid-host-abc', target: 'unraid-abc-ct-plex' }]

function fillHost() {
  fireEvent.change(screen.getByPlaceholderText(HOST_INPUT), { target: { value: 'tower' } })
}

describe('UnraidImportModal', () => {
  beforeEach(() => {
    vi.mocked(unraidApi.testConnection).mockReset()
    vi.mocked(unraidApi.importNetwork).mockReset()
    vi.mocked(unraidApi.importToPending).mockReset()
    vi.mocked(unraidApi.importToPending).mockResolvedValue({ data: { id: 'run-1', status: 'running' } } as never)
    vi.mocked(unraidApi.importNetwork).mockResolvedValue({
      data: { nodes: sampleNodes, edges: sampleEdges, device_count: 2 },
    } as never)
    vi.mocked(toast.success).mockReset()
    vi.mocked(toast.error).mockReset()
    defaultProps.onClose.mockReset()
    defaultProps.onAddToCanvas.mockReset()
    defaultProps.onInventoryImported.mockReset()
  })

  it('renders a masked API key input', () => {
    render(<UnraidImportModal {...defaultProps} />)
    expect(screen.getByText('Unraid Import')).toBeDefined()
    expect(document.querySelector('input[type="password"]')).not.toBeNull()
  })

  it('errors when testing without a host', async () => {
    render(<UnraidImportModal {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: /test connection/i }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Enter an Unraid host'))
    expect(unraidApi.testConnection).not.toHaveBeenCalled()
  })

  it('includes stopped containers and VMs by default', async () => {
    render(<UnraidImportModal {...defaultProps} />)
    fillHost()
    fireEvent.click(screen.getByRole('button', { name: /import to inventory/i }))
    await waitFor(() => expect(unraidApi.importToPending).toHaveBeenCalled())
    expect(vi.mocked(unraidApi.importToPending).mock.calls[0][0].include_offline).toBe(true)
    expect(defaultProps.onInventoryImported).toHaveBeenCalled()
  })

  it('leaves stopped devices out when the checkbox is cleared, in either mode', async () => {
    render(<UnraidImportModal {...defaultProps} />)
    fillHost()
    fireEvent.click(screen.getByLabelText('Inventory + canvas', { selector: 'input[name="unraid-import-mode"]' }))
    // One checkbox, the same in both modes - no separate canvas-only choice.
    expect(screen.queryByRole('radio', { name: /skip/i })).toBeNull()
    fireEvent.click(screen.getByLabelText('Include stopped containers and VMs'))
    fireEvent.click(screen.getByRole('button', { name: /fetch devices/i }))
    await waitFor(() => expect(unraidApi.importNetwork).toHaveBeenCalled())
    expect(vi.mocked(unraidApi.importNetwork).mock.calls[0][0].include_offline).toBe(false)
  })

  it('adds the selected server and containers to the canvas', async () => {
    render(<UnraidImportModal {...defaultProps} />)
    fillHost()
    fireEvent.click(screen.getByLabelText('Inventory + canvas', { selector: 'input[name="unraid-import-mode"]' }))
    fireEvent.click(screen.getByRole('button', { name: /fetch devices/i }))
    fireEvent.click(await screen.findByRole('button', { name: /add 2 to canvas/i }))
    expect(defaultProps.onAddToCanvas).toHaveBeenCalledWith(sampleNodes, sampleEdges)
  })

  it('sends the API key from the form', async () => {
    render(<UnraidImportModal {...defaultProps} />)
    fillHost()
    const key = document.querySelector('input[type="password"]') as HTMLInputElement
    fireEvent.change(key, { target: { value: 'secret' } })
    fireEvent.click(screen.getByRole('button', { name: /import to inventory/i }))
    await waitFor(() => expect(unraidApi.importToPending).toHaveBeenCalled())
    expect(vi.mocked(unraidApi.importToPending).mock.calls[0][0].api_key).toBe('secret')
    // Unraid ships a self-signed certificate, so verification starts off.
    expect(vi.mocked(unraidApi.importToPending).mock.calls[0][0].verify_tls).toBe(false)
  })

  it('lists VMs in their own group and warns when VMs were skipped', async () => {
    const vm = {
      id: 'unraid-abc-vm-u1', label: 'UbuntuServer', type: 'vm' as const,
      ieee_address: 'unraid-abc-vm-u1', status: 'online', model: 'KVM', parent_ieee: 'unraid-host-abc',
    }
    vi.mocked(unraidApi.importNetwork).mockResolvedValue({
      data: { nodes: [...sampleNodes, vm], edges: sampleEdges, device_count: 3, notice: 'VMs were not imported: x' },
    } as never)
    render(<UnraidImportModal {...defaultProps} />)
    fillHost()
    fireEvent.click(screen.getByLabelText('Inventory + canvas', { selector: 'input[name="unraid-import-mode"]' }))
    fireEvent.click(screen.getByRole('button', { name: /fetch devices/i }))
    const vmHeading = await screen.findByText('Virtual Machines (1)')
    // VMs come before the containers, not below a long container list.
    const containerHeading = screen.getByText('Containers (1)')
    expect(vmHeading.compareDocumentPosition(containerHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(toast.success).toHaveBeenCalledWith('Found 1 container and 1 VM')
    expect(toast.warning).toHaveBeenCalledWith('VMs were not imported: x')
  })

  it('explains that VMs come without an IP', async () => {
    const vm = {
      id: 'unraid-abc-vm-u1', label: 'UbuntuServer', type: 'vm' as const,
      ieee_address: 'unraid-abc-vm-u1', status: 'online', model: 'KVM', parent_ieee: 'unraid-host-abc',
    }
    vi.mocked(unraidApi.importNetwork).mockResolvedValue({
      data: { nodes: [...sampleNodes, vm], edges: sampleEdges, device_count: 3 },
    } as never)
    render(<UnraidImportModal {...defaultProps} />)
    fillHost()
    fireEvent.click(screen.getByLabelText('Inventory + canvas', { selector: 'input[name="unraid-import-mode"]' }))
    fireEvent.click(screen.getByRole('button', { name: /fetch devices/i }))
    expect(await screen.findByText(/does not report a VM's IP or MAC/)).toBeDefined()
  })

  it('shows no VM note when there are no VMs', async () => {
    render(<UnraidImportModal {...defaultProps} />)
    fillHost()
    fireEvent.click(screen.getByLabelText('Inventory + canvas', { selector: 'input[name="unraid-import-mode"]' }))
    fireEvent.click(screen.getByRole('button', { name: /fetch devices/i }))
    await screen.findByRole('button', { name: /add 2 to canvas/i })
    expect(screen.queryByText(/does not report a VM's IP/)).toBeNull()
  })

  it('talks plain HTTP on the default port unless Use HTTPS is ticked', async () => {
    render(<UnraidImportModal {...defaultProps} />)
    fillHost()
    expect(screen.getByText(/API key is sent unencrypted/)).toBeDefined()
    expect(screen.queryByLabelText('Verify TLS certificate')).toBeNull()
    expect(screen.getByPlaceholderText('80')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: /import to inventory/i }))
    await waitFor(() => expect(unraidApi.importToPending).toHaveBeenCalled())
    const sent = vi.mocked(unraidApi.importToPending).mock.calls[0][0]
    expect([sent.use_https, sent.port, sent.verify_tls]).toEqual([false, undefined, false])
  })

  it('offers TLS verification once HTTPS is ticked', async () => {
    render(<UnraidImportModal {...defaultProps} />)
    fillHost()
    fireEvent.click(screen.getByLabelText('Use HTTPS'))
    expect(screen.queryByText(/API key is sent unencrypted/)).toBeNull()
    expect(screen.getByPlaceholderText('443')).toBeDefined()
    fireEvent.click(screen.getByLabelText('Verify TLS certificate'))
    fireEvent.click(screen.getByRole('button', { name: /import to inventory/i }))
    await waitFor(() => expect(unraidApi.importToPending).toHaveBeenCalled())
    const sent = vi.mocked(unraidApi.importToPending).mock.calls[0][0]
    expect([sent.use_https, sent.verify_tls]).toEqual([true, true])
  })
})

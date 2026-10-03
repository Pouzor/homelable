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

  it('imports offline containers to the inventory by default', async () => {
    render(<UnraidImportModal {...defaultProps} />)
    fillHost()
    fireEvent.click(screen.getByRole('button', { name: /import to inventory/i }))
    await waitFor(() => expect(unraidApi.importToPending).toHaveBeenCalled())
    expect(vi.mocked(unraidApi.importToPending).mock.calls[0][0].offline_containers).toBe('inventory')
    expect(defaultProps.onInventoryImported).toHaveBeenCalled()
  })

  it('skips offline containers when the inventory checkbox is cleared', async () => {
    render(<UnraidImportModal {...defaultProps} />)
    fillHost()
    fireEvent.click(screen.getByLabelText('Import offline containers'))
    fireEvent.click(screen.getByRole('button', { name: /import to inventory/i }))
    await waitFor(() => expect(unraidApi.importToPending).toHaveBeenCalled())
    expect(vi.mocked(unraidApi.importToPending).mock.calls[0][0].offline_containers).toBe('skip')
  })

  it('offers three offline choices in canvas mode and sends the one picked', async () => {
    render(<UnraidImportModal {...defaultProps} />)
    fillHost()
    fireEvent.click(screen.getByLabelText('Inventory + canvas', { selector: 'input[name="unraid-import-mode"]' }))
    expect(screen.queryByLabelText('Import offline containers')).toBeNull()
    fireEvent.click(screen.getByLabelText('Inventory + canvas', { selector: 'input[name="unraid-offline"]' }))
    fireEvent.click(screen.getByRole('button', { name: /fetch containers/i }))
    await waitFor(() => expect(unraidApi.importNetwork).toHaveBeenCalled())
    expect(vi.mocked(unraidApi.importNetwork).mock.calls[0][0].offline_containers).toBe('canvas')
  })

  it('adds the selected server and containers to the canvas', async () => {
    render(<UnraidImportModal {...defaultProps} />)
    fillHost()
    fireEvent.click(screen.getByLabelText('Inventory + canvas', { selector: 'input[name="unraid-import-mode"]' }))
    fireEvent.click(screen.getByRole('button', { name: /fetch containers/i }))
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
})

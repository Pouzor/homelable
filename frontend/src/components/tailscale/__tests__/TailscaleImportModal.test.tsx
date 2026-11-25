import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { TailscaleImportModal } from '../TailscaleImportModal'

vi.mock('@/api/client', () => ({
  tailscaleApi: {
    testConnection: vi.fn(),
    importToPending: vi.fn(),
  },
}))
vi.mock('sonner', async () => (await import('@/test/mocks')).mockSonner())

import { tailscaleApi } from '@/api/client'
import { toast } from 'sonner'

const defaultProps = {
  open: true,
  onClose: vi.fn(),
}

const importResult = {
  data: { device_count: 7, pending_created: 5, pending_updated: 2, online_count: 6 },
}

const importButton = () => screen.getByRole('button', { name: /import to inventory/i })

describe('TailscaleImportModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(tailscaleApi.importToPending).mockResolvedValue(importResult as never)
  })

  it('falls back to the server credential when the fields are blank', async () => {
    render(<TailscaleImportModal {...defaultProps} />)
    fireEvent.click(importButton())

    await waitFor(() => expect(tailscaleApi.importToPending).toHaveBeenCalled())
    expect(vi.mocked(tailscaleApi.importToPending).mock.calls[0][0]).toEqual({
      oauth_client_id: undefined,
      oauth_client_secret: undefined,
      tailnet: undefined,
      include_shared: false,
      tags: [],
    })
  })

  it('sends an OAuth client, the tailnet and the filters', async () => {
    render(<TailscaleImportModal {...defaultProps} />)
    fireEvent.change(screen.getByLabelText('Client ID (optional)'), { target: { value: ' kCLIENT ' } })
    fireEvent.change(screen.getByLabelText('Client secret (optional)'), { target: { value: 'tskey-client-x' } })
    fireEvent.change(screen.getByLabelText('Tailnet'), { target: { value: 'example.com' } })
    fireEvent.change(screen.getByLabelText('Only these tags (optional)'), { target: { value: 'server, tag:nas,' } })
    fireEvent.click(screen.getByLabelText('Include devices shared in from other tailnets'))
    fireEvent.click(importButton())

    await waitFor(() => expect(tailscaleApi.importToPending).toHaveBeenCalled())
    expect(vi.mocked(tailscaleApi.importToPending).mock.calls[0][0]).toEqual({
      oauth_client_id: 'kCLIENT',
      oauth_client_secret: 'tskey-client-x',
      tailnet: 'example.com',
      include_shared: true,
      tags: ['server', 'tag:nas'],
    })
  })

  it('sends only the API token when that credential is chosen', async () => {
    render(<TailscaleImportModal {...defaultProps} />)
    fireEvent.change(screen.getByLabelText('Client ID (optional)'), { target: { value: 'kLEFTOVER' } })
    fireEvent.click(screen.getByRole('button', { name: 'API access token' }))
    fireEvent.change(screen.getByLabelText('API access token (optional)'), { target: { value: 'tskey-api-x' } })
    fireEvent.click(importButton())

    await waitFor(() => expect(tailscaleApi.importToPending).toHaveBeenCalled())
    const payload = vi.mocked(tailscaleApi.importToPending).mock.calls[0][0]
    expect(payload.api_key).toBe('tskey-api-x')
    expect(payload).not.toHaveProperty('oauth_client_id')
  })

  it('refuses half an OAuth client', () => {
    render(<TailscaleImportModal {...defaultProps} />)
    fireEvent.change(screen.getByLabelText('Client ID (optional)'), { target: { value: 'kCLIENT' } })
    fireEvent.click(importButton())

    expect(tailscaleApi.importToPending).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('Enter both the client id and the client secret')
  })

  it('shows what the connection test found', async () => {
    vi.mocked(tailscaleApi.testConnection).mockResolvedValue({
      data: { connected: true, message: 'Connected — 7 device(s) to import', device_count: 7 },
    } as never)
    render(<TailscaleImportModal {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: /test connection/i }))

    await waitFor(() => expect(screen.getByText('Connected — 7 device(s) to import')).toBeInTheDocument())
  })

  it('reports the connection failure instead of a success', async () => {
    vi.mocked(tailscaleApi.testConnection).mockResolvedValue({
      data: {
        connected: false,
        message: 'The credential may not read devices — an OAuth client needs the devices:core:read scope',
        device_count: 0,
      },
    } as never)
    render(<TailscaleImportModal {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: /test connection/i }))

    await waitFor(() => expect(screen.getByText(/needs the devices:core:read scope/)).toBeInTheDocument())
  })

  it('reports what the import created and closes', async () => {
    const onClose = vi.fn()
    const onInventoryImported = vi.fn()
    render(<TailscaleImportModal {...defaultProps} onClose={onClose} onInventoryImported={onInventoryImported} />)
    fireEvent.click(importButton())

    await waitFor(() => expect(onInventoryImported).toHaveBeenCalled())
    expect(toast.success).toHaveBeenCalledWith('Imported 7 device(s), 6 online — 5 new, 2 updated')
    expect(onClose).toHaveBeenCalled()
  })

  it('surfaces an import error and stays open', async () => {
    const onClose = vi.fn()
    vi.mocked(tailscaleApi.importToPending).mockRejectedValue(new Error('Tailscale rejected the credential'))
    render(<TailscaleImportModal {...defaultProps} onClose={onClose} />)
    fireEvent.click(importButton())

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Tailscale rejected the credential'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('keeps the actions in the body and Cancel alone in the footer', () => {
    render(<TailscaleImportModal {...defaultProps} />)
    const named = screen
      .getAllByRole('button')
      .map((b) => b.textContent?.trim())
      .filter(Boolean)
    // The credential toggle first; 'Close' is the dialog's own corner button.
    expect(named).toEqual([
      'OAuth client',
      'API access token',
      'Test Connection',
      'Import to Inventory',
      'Cancel',
      'Close',
    ])
  })

  it('explains why a scanned machine is merged by hand', () => {
    render(<TailscaleImportModal {...defaultProps} />)
    expect(screen.getByText(/reports no MAC address/i)).toBeInTheDocument()
    expect(screen.getByText('devices:core:read')).toBeInTheDocument()
  })
})

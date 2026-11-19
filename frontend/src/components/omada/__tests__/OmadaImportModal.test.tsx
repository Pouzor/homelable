import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { OmadaImportModal } from '../OmadaImportModal'

vi.mock('@/api/client', () => ({
  omadaApi: {
    testConnection: vi.fn(),
    importToPending: vi.fn(),
  },
}))
vi.mock('sonner', async () => (await import('@/test/mocks')).mockSonner())

import { omadaApi } from '@/api/client'
import { toast } from 'sonner'

const defaultProps = {
  open: true,
  onClose: vi.fn(),
}

const importResult = {
  data: {
    device_count: 9,
    pending_created: 7,
    pending_updated: 2,
    infra_count: 3,
    client_count: 6,
  },
}

function typeUrl(value = 'https://192.168.0.2:8043') {
  fireEvent.change(screen.getByPlaceholderText('https://192.168.0.2:8043'), {
    target: { value },
  })
}

describe('OmadaImportModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(omadaApi.importToPending).mockResolvedValue(importResult as never)
  })

  it('imports infrastructure of every site by default, credentials from the server', async () => {
    render(<OmadaImportModal {...defaultProps} />)
    typeUrl()
    fireEvent.click(screen.getByRole('button', { name: /import to inventory/i }))

    await waitFor(() => expect(omadaApi.importToPending).toHaveBeenCalled())
    expect(vi.mocked(omadaApi.importToPending).mock.calls[0][0]).toEqual({
      url: 'https://192.168.0.2:8043',
      omada_id: undefined,
      client_id: undefined,
      client_secret: undefined,
      site: '',
      verify_tls: false,
      modes: { infrastructure: true, clients: false },
    })
  })

  it('sends what the user typed and ticked', async () => {
    render(<OmadaImportModal {...defaultProps} />)
    typeUrl(' https://euw1-omada-northbound.tplinkcloud.com ')
    fireEvent.change(screen.getByPlaceholderText('read from the controller'), { target: { value: 'cid123' } })
    fireEvent.change(screen.getByPlaceholderText('every site'), { target: { value: 'Home' } })
    fireEvent.change(screen.getByPlaceholderText('Open API client ID'), { target: { value: 'client' } })
    fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 's3cret' } })
    fireEvent.click(screen.getByLabelText('Clients'))
    fireEvent.click(screen.getByRole('button', { name: /import to inventory/i }))

    await waitFor(() => expect(omadaApi.importToPending).toHaveBeenCalled())
    expect(vi.mocked(omadaApi.importToPending).mock.calls[0][0]).toMatchObject({
      url: 'https://euw1-omada-northbound.tplinkcloud.com',
      omada_id: 'cid123',
      client_id: 'client',
      client_secret: 's3cret',
      site: 'Home',
      modes: { infrastructure: true, clients: true },
    })
  })

  it('blocks the import when every source is unticked', () => {
    render(<OmadaImportModal {...defaultProps} />)
    typeUrl()
    fireEvent.click(screen.getByLabelText('Infrastructure'))

    expect(screen.getByRole('button', { name: /import to inventory/i })).toBeDisabled()
    expect(screen.getByText(/select at least one source/i)).toBeInTheDocument()
  })

  it('shows the per-source row counts a test returned', async () => {
    vi.mocked(omadaApi.testConnection).mockResolvedValue({
      data: {
        connected: true,
        message: 'Connected — 3 device(s) found in 1 site(s)',
        counts: { infrastructure: 3, clients: 41 },
      },
    } as never)

    render(<OmadaImportModal {...defaultProps} />)
    typeUrl()
    fireEvent.click(screen.getByLabelText('Clients'))
    fireEvent.click(screen.getByRole('button', { name: /test connection/i }))

    await waitFor(() => expect(screen.getByText('41 found')).toBeInTheDocument())
    expect(screen.getByText('3 found')).toBeInTheDocument()
    expect(screen.getByText('Connected — 3 device(s) found in 1 site(s)')).toBeInTheDocument()
    expect(vi.mocked(omadaApi.testConnection).mock.calls[0][0].modes).toEqual({
      infrastructure: true,
      clients: true,
    })
  })

  it('reports the connection failure instead of a success', async () => {
    vi.mocked(omadaApi.testConnection).mockResolvedValue({
      data: {
        connected: false,
        message: 'Authorization failed: The client id or client secret is invalid. (error -44106)',
        counts: {},
      },
    } as never)

    render(<OmadaImportModal {...defaultProps} />)
    typeUrl()
    fireEvent.click(screen.getByRole('button', { name: /test connection/i }))

    await waitFor(() => expect(screen.getByText(/authorization failed/i)).toBeInTheDocument())
  })

  it('reports what the import created and closes', async () => {
    const onClose = vi.fn()
    const onInventoryImported = vi.fn()
    render(
      <OmadaImportModal {...defaultProps} onClose={onClose} onInventoryImported={onInventoryImported} />,
    )
    typeUrl()
    fireEvent.click(screen.getByRole('button', { name: /import to inventory/i }))

    await waitFor(() => expect(onInventoryImported).toHaveBeenCalled())
    expect(toast.success).toHaveBeenCalledWith('Imported 3 device(s) and 6 client(s) — 7 new, 2 updated')
    expect(onClose).toHaveBeenCalled()
  })

  it('surfaces a failed import and stays open', async () => {
    const onClose = vi.fn()
    vi.mocked(omadaApi.importToPending).mockRejectedValue(new Error("Site 'Office' not found on the controller"))
    render(<OmadaImportModal {...defaultProps} onClose={onClose} />)
    typeUrl()
    fireEvent.click(screen.getByRole('button', { name: /import to inventory/i }))

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Site 'Office' not found on the controller"),
    )
    expect(onClose).not.toHaveBeenCalled()
  })

  it('refuses to call the API without a URL', () => {
    render(<OmadaImportModal {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: /import to inventory/i }))
    fireEvent.click(screen.getByRole('button', { name: /test connection/i }))

    expect(omadaApi.importToPending).not.toHaveBeenCalled()
    expect(omadaApi.testConnection).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('Enter the controller URL')
  })
})

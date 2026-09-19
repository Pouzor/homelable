import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { UnifiImportModal } from '../UnifiImportModal'

vi.mock('@/api/client', () => ({
  unifiApi: {
    testConnection: vi.fn(),
    importToPending: vi.fn(),
  },
}))
vi.mock('sonner', async () => (await import('@/test/mocks')).mockSonner())

import { unifiApi } from '@/api/client'
import { toast } from 'sonner'

const defaultProps = {
  open: true,
  onClose: vi.fn(),
}

const importResult = {
  data: {
    device_count: 5,
    pending_created: 4,
    pending_updated: 1,
    infra_count: 4,
    client_count: 1,
  },
}

function typeHost(value = 'unifi.local') {
  fireEvent.change(screen.getByPlaceholderText('192.168.1.x or unifi.local'), {
    target: { value },
  })
}

describe('UnifiImportModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(unifiApi.importToPending).mockResolvedValue(importResult as never)
  })

  it('imports infrastructure only by default', async () => {
    render(<UnifiImportModal {...defaultProps} />)
    typeHost()
    fireEvent.click(screen.getByRole('button', { name: /import to inventory/i }))

    await waitFor(() => expect(unifiApi.importToPending).toHaveBeenCalled())
    const payload = vi.mocked(unifiApi.importToPending).mock.calls[0][0]
    expect(payload.modes).toEqual({
      infrastructure: true,
      known_clients: false,
      active_clients: false,
    })
    expect(payload.site).toBe('default')
    expect(payload.port).toBe(8443)
  })

  it('sends the sources the user ticked', async () => {
    render(<UnifiImportModal {...defaultProps} />)
    typeHost()
    fireEvent.click(screen.getByLabelText('Known clients'))
    fireEvent.click(screen.getByLabelText('Active clients'))
    fireEvent.click(screen.getByRole('button', { name: /import to inventory/i }))

    await waitFor(() => expect(unifiApi.importToPending).toHaveBeenCalled())
    expect(vi.mocked(unifiApi.importToPending).mock.calls[0][0].modes).toEqual({
      infrastructure: true,
      known_clients: true,
      active_clients: true,
    })
  })

  it('blocks the import when every source is unticked', () => {
    render(<UnifiImportModal {...defaultProps} />)
    typeHost()
    fireEvent.click(screen.getByLabelText('Infrastructure'))

    expect(screen.getByRole('button', { name: /import to inventory/i })).toBeDisabled()
    expect(screen.getByText(/select at least one source/i)).toBeInTheDocument()
    expect(unifiApi.importToPending).not.toHaveBeenCalled()
  })

  it('shows the per-source row counts a test returned', async () => {
    vi.mocked(unifiApi.testConnection).mockResolvedValue({
      data: {
        connected: true,
        message: "Connected — 4 device(s) found in site 'default'",
        counts: { infrastructure: 4, known_clients: 412 },
      },
    } as never)

    render(<UnifiImportModal {...defaultProps} />)
    typeHost()
    fireEvent.click(screen.getByLabelText('Known clients'))
    fireEvent.click(screen.getByRole('button', { name: /test connection/i }))

    await waitFor(() => expect(screen.getByText('412 found')).toBeInTheDocument())
    expect(screen.getByText('4 found')).toBeInTheDocument()
    // The untested source stays blank rather than showing a stale zero.
    expect(screen.queryByText('0 found')).not.toBeInTheDocument()
  })

  it('asks the test for the counts of the ticked sources only', async () => {
    vi.mocked(unifiApi.testConnection).mockResolvedValue({
      data: { connected: true, message: 'ok', counts: {} },
    } as never)

    render(<UnifiImportModal {...defaultProps} />)
    typeHost()
    fireEvent.click(screen.getByLabelText('Active clients'))
    fireEvent.click(screen.getByRole('button', { name: /test connection/i }))

    await waitFor(() => expect(unifiApi.testConnection).toHaveBeenCalled())
    expect(vi.mocked(unifiApi.testConnection).mock.calls[0][0].modes).toEqual({
      infrastructure: true,
      known_clients: false,
      active_clients: true,
    })
  })

  it('reports the connection failure instead of a success', async () => {
    vi.mocked(unifiApi.testConnection).mockResolvedValue({
      data: {
        connected: false,
        message: 'UniFi device endpoint unavailable (/api/s/nope/stat/device → HTTP 401)',
        counts: {},
      },
    } as never)

    render(<UnifiImportModal {...defaultProps} />)
    typeHost()
    fireEvent.click(screen.getByRole('button', { name: /test connection/i }))

    await waitFor(() =>
      expect(screen.getByText(/endpoint unavailable/i)).toBeInTheDocument(),
    )
  })

  it('reports what the import created and closes', async () => {
    const onClose = vi.fn()
    const onInventoryImported = vi.fn()
    render(
      <UnifiImportModal
        {...defaultProps}
        onClose={onClose}
        onInventoryImported={onInventoryImported}
      />,
    )
    typeHost()
    fireEvent.click(screen.getByRole('button', { name: /import to inventory/i }))

    await waitFor(() => expect(onInventoryImported).toHaveBeenCalled())
    expect(toast.success).toHaveBeenCalledWith(
      expect.stringContaining('4 device(s) and 1 client(s)'),
    )
    expect(onClose).toHaveBeenCalled()
  })

  it('refuses to call the API without a host', () => {
    render(<UnifiImportModal {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: /import to inventory/i }))

    expect(unifiApi.importToPending).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('Enter a controller host')
  })
})

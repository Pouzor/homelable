import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ScanConfigModal } from '../ScanConfigModal'

vi.mock('@/api/client', () => ({
  scanApi: {
    getConfig: vi.fn(),
    saveConfig: vi.fn(),
  },
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))

import { scanApi } from '@/api/client'
import { toast } from 'sonner'

const defaultConfig = { data: { ranges: ['192.168.1.0/24'], interval_seconds: 60 } }

describe('ScanConfigModal', () => {
  beforeEach(() => {
    vi.mocked(scanApi.getConfig).mockResolvedValue(defaultConfig as never)
    vi.mocked(scanApi.saveConfig).mockReset()
    vi.mocked(scanApi.saveConfig).mockResolvedValue({} as never)
    vi.mocked(toast.success).mockReset()
    vi.mocked(toast.error).mockReset()
  })

  it('renders nothing when closed', () => {
    const { container } = render(<ScanConfigModal open={false} onClose={vi.fn()} onScanNow={vi.fn()} />)
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })

  it('loads config from API on open', async () => {
    render(<ScanConfigModal open onClose={vi.fn()} onScanNow={vi.fn()} />)
    await waitFor(() => {
      expect(scanApi.getConfig).toHaveBeenCalledOnce()
    })
    const input = await screen.findByDisplayValue('192.168.1.0/24')
    expect(input).toBeDefined()
  })

  it('preserves interval from API when saving ranges', async () => {
    vi.mocked(scanApi.getConfig).mockResolvedValue({ data: { ranges: ['10.0.0.0/8'], interval_seconds: 120 } } as never)
    render(<ScanConfigModal open onClose={vi.fn()} onScanNow={vi.fn()} />)
    await screen.findByDisplayValue('10.0.0.0/8')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(scanApi.saveConfig).toHaveBeenCalledWith({ ranges: ['10.0.0.0/8'], interval_seconds: 120 })
    })
  })

  it('adds a new empty range on "Add range" click', async () => {
    render(<ScanConfigModal open onClose={vi.fn()} onScanNow={vi.fn()} />)
    await screen.findByDisplayValue('192.168.1.0/24')
    fireEvent.click(screen.getByText('Add range'))
    const inputs = screen.getAllByPlaceholderText('192.168.1.0/24')
    expect(inputs).toHaveLength(2)
  })

  it('delete button disabled when only one range', async () => {
    render(<ScanConfigModal open onClose={vi.fn()} onScanNow={vi.fn()} />)
    await screen.findByDisplayValue('192.168.1.0/24')
    // Only 1 range → delete button disabled
    const trashButtons = document.querySelectorAll('button[disabled]')
    expect(trashButtons.length).toBeGreaterThan(0)
  })

  it('can remove a range when more than one exist', async () => {
    vi.mocked(scanApi.getConfig).mockResolvedValue({ data: { ranges: ['192.168.1.0/24', '10.0.0.0/8'], interval_seconds: 60 } } as never)
    render(<ScanConfigModal open onClose={vi.fn()} onScanNow={vi.fn()} />)
    await screen.findByDisplayValue('192.168.1.0/24')
    // Both trash buttons should be enabled
    const trashButtons = screen.getAllByRole('button').filter((b) => !b.hasAttribute('disabled') && b.querySelector('svg'))
    expect(trashButtons.length).toBeGreaterThanOrEqual(2)
  })

  it('shows error toast and does not save when all ranges are empty', async () => {
    vi.mocked(scanApi.getConfig).mockResolvedValue({ data: { ranges: [''], interval_seconds: 60 } } as never)
    render(<ScanConfigModal open onClose={vi.fn()} onScanNow={vi.fn()} />)
    await waitFor(() => expect(scanApi.getConfig).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Add at least one IP range')
    })
    expect(scanApi.saveConfig).not.toHaveBeenCalled()
  })

  it('saves config and closes on Save click', async () => {
    const onClose = vi.fn()
    render(<ScanConfigModal open onClose={onClose} onScanNow={vi.fn()} />)
    await screen.findByDisplayValue('192.168.1.0/24')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(scanApi.saveConfig).toHaveBeenCalledWith({ ranges: ['192.168.1.0/24'], interval_seconds: 60 })
      expect(toast.success).toHaveBeenCalledWith('Scan config saved')
      expect(onClose).toHaveBeenCalledOnce()
    })
  })

  it('shows error toast when save fails', async () => {
    vi.mocked(scanApi.saveConfig).mockRejectedValue(new Error('network'))
    render(<ScanConfigModal open onClose={vi.fn()} onScanNow={vi.fn()} />)
    await screen.findByDisplayValue('192.168.1.0/24')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Failed to save config')
    })
  })

  it('calls onScanNow after saving on "Scan Now" click', async () => {
    const onScanNow = vi.fn()
    const onClose = vi.fn()
    render(<ScanConfigModal open onClose={onClose} onScanNow={onScanNow} />)
    await screen.findByDisplayValue('192.168.1.0/24')
    fireEvent.click(screen.getByRole('button', { name: 'Scan Now' }))
    await waitFor(() => {
      expect(scanApi.saveConfig).toHaveBeenCalled()
      expect(onScanNow).toHaveBeenCalledOnce()
    })
  })

  it('calls onClose when Cancel is clicked', async () => {
    const onClose = vi.fn()
    render(<ScanConfigModal open onClose={onClose} onScanNow={vi.fn()} />)
    await waitFor(() => expect(scanApi.getConfig).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('strips whitespace from ranges before saving', async () => {
    render(<ScanConfigModal open onClose={vi.fn()} onScanNow={vi.fn()} />)
    const input = await screen.findByDisplayValue('192.168.1.0/24')
    // Type a range with surrounding whitespace
    fireEvent.change(input, { target: { value: '  10.0.0.0/8  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(scanApi.saveConfig).toHaveBeenCalledWith(
        expect.objectContaining({ ranges: ['10.0.0.0/8'] })
      )
    })
  })
})

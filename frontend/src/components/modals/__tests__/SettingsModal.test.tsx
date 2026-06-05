import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SettingsModal } from '../SettingsModal'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/api/client', () => ({
  settingsApi: {
    get: vi.fn(),
    save: vi.fn(),
  },
}))

import { settingsApi } from '@/api/client'
import { toast } from 'sonner'

describe('SettingsModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(settingsApi.get).mockResolvedValue({ data: { interval_seconds: 60 } } as never)
    vi.mocked(settingsApi.save).mockResolvedValue({ data: { interval_seconds: 60 } } as never)
    vi.mocked(toast.success).mockReset()
    vi.mocked(toast.error).mockReset()
  })

  it('loads interval from API when opened', async () => {
    render(<SettingsModal open onClose={vi.fn()} />)
    await waitFor(() => expect(settingsApi.get).toHaveBeenCalledOnce())
    expect(screen.getByText('Status check interval (s)')).toBeDefined()
  })

  it('does not fetch when closed', () => {
    render(<SettingsModal open={false} onClose={vi.fn()} />)
    expect(settingsApi.get).not.toHaveBeenCalled()
  })

  it('displays interval loaded from API', async () => {
    vi.mocked(settingsApi.get).mockResolvedValue({ data: { interval_seconds: 120 } } as never)
    render(<SettingsModal open onClose={vi.fn()} />)
    expect(await screen.findByDisplayValue('120')).toBeDefined()
  })

  it('saves interval and closes on Save click', async () => {
    const onClose = vi.fn()
    render(<SettingsModal open onClose={onClose} />)
    const input = await screen.findByDisplayValue('60')
    fireEvent.change(input, { target: { value: '180' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(settingsApi.save).toHaveBeenCalledWith({ interval_seconds: 180 })
      expect(toast.success).toHaveBeenCalledWith('Settings saved')
      expect(onClose).toHaveBeenCalled()
    })
  })

  it('shows error toast and stays open when save fails', async () => {
    vi.mocked(settingsApi.save).mockRejectedValue(new Error('network'))
    const onClose = vi.fn()
    render(<SettingsModal open onClose={onClose} />)
    await screen.findByDisplayValue('60')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Failed to save settings')
    })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('calls onClose on Cancel', async () => {
    const onClose = vi.fn()
    render(<SettingsModal open onClose={onClose} />)
    await screen.findByDisplayValue('60')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})

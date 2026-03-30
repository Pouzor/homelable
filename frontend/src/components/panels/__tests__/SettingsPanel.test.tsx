import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { Sidebar } from '../Sidebar'
import * as canvasStore from '@/stores/canvasStore'
import { TooltipProvider } from '@/components/ui/tooltip'

vi.mock('@/stores/canvasStore')
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/api/client', () => ({
  scanApi: {
    trigger: vi.fn(),
    pending: vi.fn().mockResolvedValue({ data: [] }),
    hidden: vi.fn().mockResolvedValue({ data: [] }),
    runs: vi.fn().mockResolvedValue({ data: [] }),
    getConfig: vi.fn().mockResolvedValue({ data: { ranges: [] } }),
  },
  settingsApi: {
    get: vi.fn(),
    save: vi.fn(),
  },
}))

import { settingsApi } from '@/api/client'
import { toast } from 'sonner'

function renderSidebar() {
  vi.mocked(canvasStore.useCanvasStore).mockReturnValue({
    nodes: [],
    hasUnsavedChanges: false,
    hideIp: false,
    toggleHideIp: vi.fn(),
    addNode: vi.fn(),
    scanEventTs: 0,
  } as unknown as ReturnType<typeof canvasStore.useCanvasStore>)

  return render(
    <TooltipProvider>
      <Sidebar
        onAddNode={vi.fn()}
        onAddGroupRect={vi.fn()}
        onScan={vi.fn()}
        onSave={vi.fn()}
        onNodeApproved={vi.fn()}
      />
    </TooltipProvider>
  )
}

describe('SettingsPanel', () => {
  beforeEach(() => {
    vi.mocked(settingsApi.get).mockResolvedValue({ data: { interval_seconds: 60 } } as never)
    vi.mocked(settingsApi.save).mockResolvedValue({ data: { interval_seconds: 60 } } as never)
    vi.mocked(toast.success).mockReset()
    vi.mocked(toast.error).mockReset()
  })

  it('opens when Settings item is clicked', async () => {
    renderSidebar()
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    await waitFor(() => {
      expect(settingsApi.get).toHaveBeenCalledOnce()
    })
    expect(screen.getByText('Status check interval (s)')).toBeDefined()
  })

  it('displays interval loaded from API', async () => {
    vi.mocked(settingsApi.get).mockResolvedValue({ data: { interval_seconds: 120 } } as never)
    renderSidebar()
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    const input = await screen.findByDisplayValue('120')
    expect(input).toBeDefined()
  })

  it('saves interval via settingsApi on Save click', async () => {
    renderSidebar()
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    const input = await screen.findByDisplayValue('60')
    fireEvent.change(input, { target: { value: '180' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(settingsApi.save).toHaveBeenCalledWith({ interval_seconds: 180 })
      expect(toast.success).toHaveBeenCalledWith('Settings saved')
    })
  })

  it('shows error toast when save fails', async () => {
    vi.mocked(settingsApi.save).mockRejectedValue(new Error('network'))
    renderSidebar()
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    await screen.findByDisplayValue('60')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Failed to save settings')
    })
  })

  it('closes panel when Settings is clicked again', async () => {
    renderSidebar()
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    await screen.findByText('Status check interval (s)')
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(screen.queryByText('Status check interval (s)')).toBeNull()
  })
})

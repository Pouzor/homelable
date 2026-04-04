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
    stop: vi.fn(),
    getConfig: vi.fn().mockResolvedValue({ data: { ranges: [] } }),
  },
  settingsApi: { get: vi.fn(), save: vi.fn() },
  nodeHistoryApi: { list: vi.fn().mockResolvedValue({ data: [] }) },
}))

import { scanApi } from '@/api/client'
import { toast } from 'sonner'

const RUNNING_RUN = {
  id: 'run-1',
  status: 'running',
  ranges: ['192.168.1.0/24'],
  devices_found: 2,
  started_at: new Date().toISOString(),
  finished_at: null,
  error: null,
}

const DONE_RUN = {
  id: 'run-2',
  status: 'done',
  ranges: ['192.168.1.0/24'],
  devices_found: 3,
  started_at: new Date().toISOString(),
  finished_at: new Date().toISOString(),
  error: null,
}

const CANCELLED_RUN = {
  id: 'run-3',
  status: 'cancelled',
  ranges: ['192.168.1.0/24'],
  devices_found: 1,
  started_at: new Date().toISOString(),
  finished_at: new Date().toISOString(),
  error: null,
}

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

async function openHistory() {
  fireEvent.click(screen.getByRole('button', { name: 'Scan History' }))
  // Wait for runs to load
  await waitFor(() => expect(scanApi.runs).toHaveBeenCalled())
}

describe('ScanHistoryPanel — stop scan', () => {
  beforeEach(() => {
    vi.mocked(toast.success).mockReset()
    vi.mocked(toast.error).mockReset()
    vi.mocked(scanApi.stop).mockReset()
    vi.mocked(scanApi.runs).mockResolvedValue({ data: [] } as never)
  })

  it('shows stop button only for running scans', async () => {
    vi.mocked(scanApi.runs).mockResolvedValue({ data: [RUNNING_RUN, DONE_RUN] } as never)
    renderSidebar()
    await openHistory()

    await waitFor(() => expect(screen.getByText('running')).toBeDefined())

    // Exactly one stop button rendered (for the running scan only)
    const stopButtons = screen.getAllByRole('button', { name: 'Stop scan' })
    expect(stopButtons).toHaveLength(1)
  })

  it('calls scanApi.stop with the correct run ID on click', async () => {
    vi.mocked(scanApi.stop).mockResolvedValue({ data: { stopping: true } } as never)
    vi.mocked(scanApi.runs).mockResolvedValue({ data: [RUNNING_RUN] } as never)
    renderSidebar()
    await openHistory()

    const stopBtn = await screen.findByRole('button', { name: 'Stop scan' })
    fireEvent.click(stopBtn)

    await waitFor(() => {
      expect(scanApi.stop).toHaveBeenCalledWith('run-1')
    })
  })

  it('shows success toast when stop succeeds', async () => {
    vi.mocked(scanApi.stop).mockResolvedValue({ data: { stopping: true } } as never)
    vi.mocked(scanApi.runs).mockResolvedValue({ data: [RUNNING_RUN] } as never)
    renderSidebar()
    await openHistory()

    const stopBtn = await screen.findByRole('button', { name: 'Stop scan' })
    fireEvent.click(stopBtn)

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('Scan stop requested')
    })
  })

  it('shows error toast when stop fails', async () => {
    vi.mocked(scanApi.stop).mockRejectedValue(new Error('network'))
    vi.mocked(scanApi.runs).mockResolvedValue({ data: [RUNNING_RUN] } as never)
    renderSidebar()
    await openHistory()

    const stopBtn = await screen.findByRole('button', { name: 'Stop scan' })
    fireEvent.click(stopBtn)

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Failed to stop scan')
    })
  })

  it('renders cancelled status without stop button or spinner', async () => {
    vi.mocked(scanApi.runs).mockResolvedValue({ data: [CANCELLED_RUN] } as never)
    renderSidebar()
    await openHistory()

    await waitFor(() => expect(screen.getByText('cancelled')).toBeDefined())

    // No stop button
    expect(screen.queryByRole('button', { name: 'Stop scan' })).toBeNull()
  })
})

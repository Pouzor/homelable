import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ScanHistoryModal } from '../ScanHistoryModal'
import { TooltipProvider } from '@/components/ui/tooltip'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/stores/canvasStore', () => ({
  useCanvasStore: { getState: () => ({ notifyScanDeviceFound: vi.fn() }) },
}))
vi.mock('@/api/client', () => ({
  scanApi: {
    runs: vi.fn().mockResolvedValue({ data: [] }),
    stop: vi.fn(),
  },
}))

import { scanApi } from '@/api/client'
import { toast } from 'sonner'

const RUNNING_RUN = {
  id: 'run-1',
  status: 'running',
  kind: 'ip',
  ranges: ['192.168.1.0/24'],
  devices_found: 2,
  started_at: new Date(Date.now() - 5000).toISOString(),
  finished_at: null,
  error: null,
}

const DONE_RUN = {
  id: 'run-2',
  status: 'done',
  kind: 'ip',
  ranges: ['192.168.1.0/24'],
  devices_found: 3,
  started_at: new Date(Date.now() - 60000).toISOString(),
  finished_at: new Date(Date.now() - 30000).toISOString(),
  error: null,
}

const CANCELLED_RUN = {
  id: 'run-3',
  status: 'cancelled',
  kind: 'ip',
  ranges: ['192.168.1.0/24'],
  devices_found: 1,
  started_at: new Date().toISOString(),
  finished_at: new Date().toISOString(),
  error: null,
}

const ZIGBEE_RUN = {
  id: 'run-4',
  status: 'done',
  kind: 'zigbee',
  ranges: [],
  devices_found: 7,
  started_at: new Date().toISOString(),
  finished_at: new Date().toISOString(),
  error: null,
}

const ZWAVE_RUN = {
  id: 'run-5',
  status: 'done',
  kind: 'zwave',
  ranges: [],
  devices_found: 5,
  started_at: new Date().toISOString(),
  finished_at: new Date().toISOString(),
  error: null,
}

function renderModal() {
  return render(
    <TooltipProvider>
      <ScanHistoryModal open onClose={vi.fn()} />
    </TooltipProvider>
  )
}

describe('ScanHistoryModal', () => {
  beforeEach(() => {
    vi.mocked(toast.success).mockReset()
    vi.mocked(toast.error).mockReset()
    vi.mocked(scanApi.stop).mockReset()
    vi.mocked(scanApi.runs).mockResolvedValue({ data: [] } as never)
  })

  it('loads runs when opened', async () => {
    vi.mocked(scanApi.runs).mockResolvedValue({ data: [DONE_RUN] } as never)
    renderModal()
    await waitFor(() => expect(scanApi.runs).toHaveBeenCalled())
    expect(await screen.findByText('done')).toBeDefined()
  })

  it('shows empty state when no scans', async () => {
    renderModal()
    expect(await screen.findByText('No scans yet')).toBeDefined()
  })

  it('shows stop button only for running scans', async () => {
    vi.mocked(scanApi.runs).mockResolvedValue({ data: [RUNNING_RUN, DONE_RUN] } as never)
    renderModal()
    await waitFor(() => expect(screen.getByText('running')).toBeDefined())
    expect(screen.getAllByRole('button', { name: 'Stop scan' })).toHaveLength(1)
  })

  it('calls scanApi.stop with the correct run ID', async () => {
    vi.mocked(scanApi.stop).mockResolvedValue({ data: { stopping: true } } as never)
    vi.mocked(scanApi.runs).mockResolvedValue({ data: [RUNNING_RUN] } as never)
    renderModal()
    const stopBtn = await screen.findByRole('button', { name: 'Stop scan' })
    fireEvent.click(stopBtn)
    await waitFor(() => expect(scanApi.stop).toHaveBeenCalledWith('run-1'))
  })

  it('shows success toast when stop succeeds', async () => {
    vi.mocked(scanApi.stop).mockResolvedValue({ data: { stopping: true } } as never)
    vi.mocked(scanApi.runs).mockResolvedValue({ data: [RUNNING_RUN] } as never)
    renderModal()
    const stopBtn = await screen.findByRole('button', { name: 'Stop scan' })
    fireEvent.click(stopBtn)
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Scan stop requested'))
  })

  it('shows error toast when stop fails', async () => {
    vi.mocked(scanApi.stop).mockRejectedValue(new Error('network'))
    vi.mocked(scanApi.runs).mockResolvedValue({ data: [RUNNING_RUN] } as never)
    renderModal()
    const stopBtn = await screen.findByRole('button', { name: 'Stop scan' })
    fireEvent.click(stopBtn)
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to stop scan'))
  })

  it('renders cancelled status without a stop button', async () => {
    vi.mocked(scanApi.runs).mockResolvedValue({ data: [CANCELLED_RUN] } as never)
    renderModal()
    await waitFor(() => expect(screen.getByText('cancelled')).toBeDefined())
    expect(screen.queryByRole('button', { name: 'Stop scan' })).toBeNull()
  })

  it('shows duration for a finished run', async () => {
    vi.mocked(scanApi.runs).mockResolvedValue({ data: [DONE_RUN] } as never)
    renderModal()
    // DONE_RUN ran 30s
    expect(await screen.findByText('30s')).toBeDefined()
  })

  it('filters by status', async () => {
    vi.mocked(scanApi.runs).mockResolvedValue({ data: [RUNNING_RUN, DONE_RUN] } as never)
    renderModal()
    await waitFor(() => expect(screen.getByText('done')).toBeDefined())
    fireEvent.click(screen.getByRole('button', { name: 'Running' }))
    expect(screen.queryByText('done')).toBeNull()
    expect(screen.getByText('running')).toBeDefined()
  })

  it('filters by kind', async () => {
    vi.mocked(scanApi.runs).mockResolvedValue({ data: [DONE_RUN, ZIGBEE_RUN] } as never)
    renderModal()
    await waitFor(() => expect(screen.getAllByText('done').length).toBe(2))
    fireEvent.click(screen.getByRole('button', { name: 'Zigbee' }))
    // Only the zigbee run (7 found) remains
    expect(screen.getByText('7 found')).toBeDefined()
    expect(screen.queryByText('3 found')).toBeNull()
  })

  it('filters by zwave kind', async () => {
    vi.mocked(scanApi.runs).mockResolvedValue({ data: [DONE_RUN, ZWAVE_RUN] } as never)
    renderModal()
    await waitFor(() => expect(screen.getAllByText('done').length).toBe(2))
    fireEvent.click(screen.getByRole('button', { name: 'Z-Wave' }))
    // Only the zwave run (5 found) remains
    expect(screen.getByText('5 found')).toBeDefined()
    expect(screen.queryByText('3 found')).toBeNull()
  })
})

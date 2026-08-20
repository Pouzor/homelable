/**
 * Per-device deep rescan (issue #350) — the detail modal starts a full-port
 * scan of one device, waits on the run, and folds the fresh services back in.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { InventoryDeviceModal } from '../InventoryDeviceModal'
import type { InventoryEntry } from '@/types'

const mockRescanDevice = vi.fn()
const mockRun = vi.fn()
const mockPending = vi.fn()
const mockStop = vi.fn()

vi.mock('@/api/client', () => ({
  scanApi: {
    updatePending: vi.fn(),
    rescanDevice: (...a: unknown[]) => mockRescanDevice(...a),
    run: (...a: unknown[]) => mockRun(...a),
    pending: (...a: unknown[]) => mockPending(...a),
    stop: (...a: unknown[]) => mockStop(...a),
  },
}))

vi.mock('sonner', async () => (await import('@/test/mocks')).mockSonner())

function makeDevice(overrides: Partial<InventoryEntry> = {}): InventoryEntry {
  return {
    id: 'dev-1',
    ip: '192.168.1.100',
    mac: 'aa:bb:cc:dd:ee:ff',
    hostname: 'pve.local',
    os: 'Linux',
    services: [],
    suggested_type: 'server',
    status: 'pending',
    discovered_at: '2024-01-15T10:30:00Z',
    ...overrides,
  }
}

/** The link opens the port-range dialog; the scan starts from there. */
async function startScan() {
  fireEvent.click(screen.getByTestId('device-rescan'))
  await waitFor(() => expect(screen.getByTestId('deep-scan-start')).toBeInTheDocument())
  // The start resolves a promise that sets state — act() keeps that update
  // inside the test's control, fake timers or not.
  await act(async () => { fireEvent.click(screen.getByTestId('deep-scan-start')) })
}

const noop = { onClose: vi.fn(), onApprove: vi.fn(), onHide: vi.fn(), onIgnore: vi.fn() }

beforeEach(() => {
  vi.clearAllMocks()
  mockRescanDevice.mockResolvedValue({ data: { id: 'run-1', status: 'running' } })
  mockRun.mockResolvedValue({ data: { id: 'run-1', status: 'running', error: null } })
  mockPending.mockResolvedValue({ data: [] })
  mockStop.mockResolvedValue({ data: {} })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('InventoryDeviceModal — deep rescan', () => {
  it('offers the deep scan only when the device has an IP', () => {
    const { rerender } = render(<InventoryDeviceModal {...noop} device={makeDevice()} />)
    expect(screen.getByTestId('device-rescan')).toBeInTheDocument()

    rerender(<InventoryDeviceModal {...noop} device={makeDevice({ id: 'dev-2', ip: null })} />)
    expect(screen.queryByTestId('device-rescan')).toBeNull()
  })

  it('is absent for a Zigbee device — it has no IP services at all', () => {
    render(
      <InventoryDeviceModal
        {...noop}
        device={makeDevice({ discovery_source: 'zigbee', ieee_address: '0x00124b' })}
      />
    )
    expect(screen.queryByTestId('device-rescan')).toBeNull()
  })

  it('scans every port and swaps to a stop control while it runs', async () => {
    render(<InventoryDeviceModal {...noop} device={makeDevice()} />)
    await startScan()

    await waitFor(() => expect(screen.getByTestId('device-rescan-stop')).toBeInTheDocument())
    expect(mockRescanDevice).toHaveBeenCalledWith('dev-1', { ports: '1-65535' })
    expect(screen.queryByTestId('device-rescan')).toBeNull()
  })

  it('sends the range the user typed instead of the whole space', async () => {
    render(<InventoryDeviceModal {...noop} device={makeDevice()} />)
    fireEvent.click(screen.getByTestId('device-rescan'))
    const input = await screen.findByTestId('deep-scan-ports')
    expect(input).toHaveValue('1-65535')

    fireEvent.change(input, { target: { value: '80,443,8000-9000' } })
    fireEvent.click(screen.getByTestId('deep-scan-start'))

    await waitFor(() =>
      expect(mockRescanDevice).toHaveBeenCalledWith('dev-1', { ports: '80,443,8000-9000' })
    )
  })

  it('refuses to start on a range nmap could not use', async () => {
    render(<InventoryDeviceModal {...noop} device={makeDevice()} />)
    fireEvent.click(screen.getByTestId('device-rescan'))
    const input = await screen.findByTestId('deep-scan-ports')

    fireEvent.change(input, { target: { value: '99999' } })
    expect(screen.getByTestId('deep-scan-start')).toBeDisabled()

    fireEvent.click(screen.getByTestId('deep-scan-start'))
    expect(mockRescanDevice).not.toHaveBeenCalled()
  })

  it('stops the run through the same ScanRun the header uses', async () => {
    render(<InventoryDeviceModal {...noop} device={makeDevice()} />)
    await startScan()
    await waitFor(() => expect(screen.getByTestId('device-rescan-stop')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('device-rescan-stop'))
    await waitFor(() => expect(mockStop).toHaveBeenCalledWith('run-1'))
  })

  it('keeps the button enabled again when the start is refused', async () => {
    mockRescanDevice.mockRejectedValue({
      response: { data: { detail: 'A scan is already running for this device' } },
    })
    const { toast } = await import('sonner')
    render(<InventoryDeviceModal {...noop} device={makeDevice()} />)
    await startScan()

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('A scan is already running for this device')
    )
    expect(screen.getByTestId('device-rescan')).toBeInTheDocument()
  })

  it('folds the freshly found services back into the open modal', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const onSaved = vi.fn()
    const fresh = makeDevice({
      services: [{ port: 8096, protocol: 'tcp', service_name: 'Jellyfin' }],
    })
    render(<InventoryDeviceModal {...noop} onSaved={onSaved} device={makeDevice()} />)
    await startScan()
    await waitFor(() => expect(screen.getByTestId('device-rescan-stop')).toBeInTheDocument())

    mockRun.mockResolvedValue({ data: { id: 'run-1', status: 'done', error: null } })
    mockPending.mockResolvedValue({ data: [fresh] })
    await act(async () => { await vi.advanceTimersByTimeAsync(3100) })

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(fresh))
    // Polling ends with the run — no second request once it is done.
    const calls = mockRun.mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(6000) })
    expect(mockRun.mock.calls.length).toBe(calls)
  })

  it('keeps an edit in progress when the scan lands', async () => {
    // The parent patches the row in place on onSaved (`setSelected(saved)`),
    // handing down a new object for the same device. That must not throw away
    // a form the user is still filling in — a deep scan runs for minutes.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const onSaved = vi.fn()
    const device = makeDevice()
    const fresh = makeDevice({
      services: [{ port: 8096, protocol: 'tcp', service_name: 'Jellyfin' }],
    })
    const { rerender } = render(
      <InventoryDeviceModal {...noop} onSaved={onSaved} device={device} />
    )
    await startScan()
    await waitFor(() => expect(screen.getByTestId('device-rescan-stop')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByPlaceholderText('Display name'), { target: { value: 'Media box' } })

    mockRun.mockResolvedValue({ data: { id: 'run-1', status: 'done', error: null } })
    mockPending.mockResolvedValue({ data: [fresh] })
    await act(async () => { await vi.advanceTimersByTimeAsync(3100) })

    // The fresh row still reaches the canvas and the grid — the scan is not
    // discarded just because a form is open.
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(fresh))
    rerender(<InventoryDeviceModal {...noop} onSaved={onSaved} device={fresh} />)

    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
    expect(screen.getByDisplayValue('Media box')).toBeInTheDocument()
  })

  it('still resets the form when pointed at another device', async () => {
    const { rerender } = render(<InventoryDeviceModal {...noop} device={makeDevice()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByPlaceholderText('Display name'), { target: { value: 'Media box' } })

    rerender(<InventoryDeviceModal {...noop} device={makeDevice({ id: 'dev-2' })} />)

    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
    expect(screen.queryByDisplayValue('Media box')).toBeNull()
  })

  it('says partial when the sweep ran out of budget', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { toast } = await import('sonner')
    const fresh = makeDevice({ services: [{ port: 22, protocol: 'tcp', service_name: 'SSH' }] })
    render(<InventoryDeviceModal {...noop} device={makeDevice()} />)
    await startScan()
    await waitFor(() => expect(screen.getByTestId('device-rescan-stop')).toBeInTheDocument())

    // A done run carrying an advisory — it scanned part of the range only.
    mockRun.mockResolvedValue({
      data: { id: 'run-1', status: 'done', error: 'Scanned 3/8 port ranges (1 open) — the rest was not reached' },
    })
    mockPending.mockResolvedValue({ data: [fresh] })
    await act(async () => { await vi.advanceTimersByTimeAsync(3100) })

    await waitFor(() =>
      expect(toast.warning).toHaveBeenCalledWith(
        expect.stringContaining('Scan partial — 1 service')
      )
    )
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('surfaces a failed run instead of silently ending', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { toast } = await import('sonner')
    render(<InventoryDeviceModal {...noop} device={makeDevice()} />)
    await startScan()
    await waitFor(() => expect(screen.getByTestId('device-rescan-stop')).toBeInTheDocument())

    mockRun.mockResolvedValue({ data: { id: 'run-1', status: 'error', error: 'nmap missing' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(3100) })

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Scan failed: nmap missing'))
    expect(mockPending).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByTestId('device-rescan')).toBeInTheDocument())
  })
})

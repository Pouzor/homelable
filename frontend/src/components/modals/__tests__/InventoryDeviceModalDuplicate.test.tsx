/**
 * Duplicate from the device detail modal (issue #481): a redundant pair is two
 * identical boxes, so the second one starts as a copy of the first.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { InventoryDeviceModal } from '../InventoryDeviceModal'
import type { InventoryEntry } from '@/types'

const mockDuplicatePending = vi.fn()

vi.mock('@/api/client', () => ({
  scanApi: {
    duplicatePending: (...a: unknown[]) => mockDuplicatePending(...a),
  },
}))

vi.mock('sonner', async () => (await import('@/test/mocks')).mockSonner())

function makeDevice(overrides: Partial<InventoryEntry> = {}): InventoryEntry {
  return {
    id: 'dev-1',
    ip: '192.168.1.20',
    mac: 'aa:bb:cc:44:55:66',
    hostname: 'sw-core-1',
    os: null,
    services: [],
    suggested_type: 'switch',
    status: 'pending',
    discovered_at: '2026-01-15T10:30:00Z',
    label: 'Core switch',
    ...overrides,
  }
}

const COPY = makeDevice({ id: 'dev-2', ip: null, mac: null, hostname: null, label: 'Core switch (copy)' })

const noop = { onClose: vi.fn(), onApprove: vi.fn(), onHide: vi.fn(), onIgnore: vi.fn() }

/** The parent's half: point the modal at whatever the duplicate returned. */
function Host({ onDuplicated }: { onDuplicated?: (copy: InventoryEntry) => void }) {
  const [device, setDevice] = useState<InventoryEntry>(makeDevice())
  return (
    <InventoryDeviceModal
      {...noop}
      device={device}
      onDuplicated={(copy) => {
        onDuplicated?.(copy)
        setDevice(copy)
      }}
    />
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockDuplicatePending.mockResolvedValue({ data: COPY })
})

describe('InventoryDeviceModal — duplicate', () => {
  it('offers no Duplicate where the caller cannot take the copy', () => {
    render(<InventoryDeviceModal {...noop} device={makeDevice()} />)
    expect(screen.queryByRole('button', { name: /Duplicate/ })).toBeNull()
  })

  it('duplicates the shown device and hands the copy to the caller', async () => {
    const onDuplicated = vi.fn()
    render(<Host onDuplicated={onDuplicated} />)
    fireEvent.click(screen.getByRole('button', { name: /Duplicate/ }))
    await waitFor(() => expect(onDuplicated).toHaveBeenCalledWith(COPY))
    expect(mockDuplicatePending).toHaveBeenCalledWith('dev-1')
  })

  it('opens the copy in edit mode, its addresses being the first thing to set', async () => {
    render(<Host />)
    fireEvent.click(screen.getByRole('button', { name: /Duplicate/ }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument())
    expect(screen.getAllByText('Core switch (copy)').length).toBeGreaterThan(0)
  })

  it('stays on the source in view mode when the duplicate fails', async () => {
    const { toast } = await import('sonner')
    mockDuplicatePending.mockRejectedValue(new Error('boom'))
    const onDuplicated = vi.fn()
    render(<Host onDuplicated={onDuplicated} />)
    fireEvent.click(screen.getByRole('button', { name: /Duplicate/ }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Could not duplicate device'))
    expect(onDuplicated).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /Duplicate/ })).not.toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
  })

  it('disables the button while the copy is on its way', async () => {
    let resolve: (v: unknown) => void = () => {}
    mockDuplicatePending.mockReturnValue(new Promise((r) => { resolve = r }))
    render(<Host />)
    fireEvent.click(screen.getByRole('button', { name: /Duplicate/ }))
    await waitFor(() => expect(screen.getByRole('button', { name: /Duplicate/ })).toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: /Duplicate/ }))
    expect(mockDuplicatePending).toHaveBeenCalledTimes(1)
    resolve({ data: COPY })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument())
  })
})

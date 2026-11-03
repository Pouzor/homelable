/**
 * The inventory list's half of Duplicate (issue #481): the copy joins the list
 * next to its source, and the detail modal moves onto it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DeviceInventoryModal } from '../DeviceInventoryModal'
import { useCanvasStore } from '@/stores/canvasStore'

vi.mock('@/stores/canvasStore')

const mockPending = vi.fn()
const mockHidden = vi.fn()

vi.mock('@/api/client', () => ({
  scanApi: {
    pending: (...a: unknown[]) => mockPending(...a),
    hidden: (...a: unknown[]) => mockHidden(...a),
  },
}))

vi.mock('sonner', async () => (await import('@/test/mocks')).mockSonner())

vi.mock('@/components/modals/InventoryDeviceModal', () => ({
  InventoryDeviceModal: ({
    device,
    onDuplicated,
  }: {
    device: { id: string } | null
    onDuplicated?: (copy: unknown) => void
  }) =>
    device ? (
      <div data-testid={`detail-${device.id}`}>
        {onDuplicated && (
          <button data-testid="duplicate" onClick={() => onDuplicated({ ...COPY })}>duplicate</button>
        )}
      </div>
    ) : null,
}))

function device(id: string, hostname: string) {
  return {
    id,
    ip: null,
    hostname,
    mac: null,
    os: null,
    services: [],
    suggested_type: 'switch',
    status: 'pending',
    discovery_source: 'manual',
    discovered_at: '2026-01-01T00:00:00Z',
  }
}

const SW1 = device('sw-1', 'sw-core-1')
const OTHER = device('other', 'other-box')
const COPY = { ...device('sw-1-copy', ''), hostname: null, label: 'sw-core-1 (copy)' }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(useCanvasStore).mockImplementation(((sel?: (s: unknown) => unknown) => {
    const store = { addNode: vi.fn(), scanEventTs: 0, setSelectedNode: vi.fn() }
    return sel ? sel(store) : store
  }) as unknown as typeof useCanvasStore)
  mockPending.mockResolvedValue({ data: [SW1, OTHER] })
  mockHidden.mockResolvedValue({ data: [SW1] })
})

Element.prototype.scrollIntoView = vi.fn()

const cardIds = () =>
  screen.getAllByTestId(/^pending-card-/).map((el) => el.getAttribute('data-testid')!.replace('pending-card-', ''))

describe('DeviceInventoryModal — duplicate', () => {
  it('lists the copy right after its source and opens it', async () => {
    render(<DeviceInventoryModal open onClose={vi.fn()} highlightId="sw-1" />)
    await waitFor(() => expect(screen.getByTestId('detail-sw-1')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('duplicate'))
    await waitFor(() => expect(screen.getByTestId('detail-sw-1-copy')).toBeInTheDocument())
    expect(cardIds()).toEqual(['sw-1', 'sw-1-copy', 'other'])
  })

  it('keeps a pending copy out of the hidden list, but still opens it', async () => {
    render(<DeviceInventoryModal open onClose={vi.fn()} initialStatus="hidden" highlightId="sw-1" />)
    await waitFor(() => expect(screen.getByTestId('detail-sw-1')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('duplicate'))
    await waitFor(() => expect(screen.getByTestId('detail-sw-1-copy')).toBeInTheDocument())
    expect(screen.queryByTestId('pending-card-sw-1-copy')).toBeNull()
  })

  it('offers no Duplicate in the tour, which never reaches the backend', async () => {
    render(<DeviceInventoryModal open onClose={vi.fn()} demoDevices={[SW1] as never} highlightId="sw-1" />)
    await waitFor(() => expect(screen.getByTestId('detail-sw-1')).toBeInTheDocument())
    expect(screen.queryByTestId('duplicate')).toBeNull()
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { api } from '@/api/client'
import { ObservatoryModal } from '../ObservatoryModal'

vi.mock('@/api/client', () => ({ api: { get: vi.fn() } }))
beforeEach(() => vi.mocked(api.get).mockReset())
afterEach(cleanup)

describe('Observatory monitoring', () => {
  it('does not request a snapshot while closed', () => {
    render(<ObservatoryModal open={false} onClose={() => {}} />)
    expect(api.get).not.toHaveBeenCalled()
  })
  it('explains the disabled integration', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { enabled: false } })
    render(<ObservatoryModal open onClose={() => {}} />)
    expect(await screen.findByText(/Not connected/)).toBeInTheDocument()
  })
  it('keeps unknown CPU distinct from zero and shows stale evidence', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { enabled: true, stale: true,
      dashboard_url: 'https://monitor.example.com', insights: [], snapshot: {
        collected_at: '2020-01-01T00:00:00Z', stale_after_seconds: 60,
        collection_state: 'partial', host: { name: 'lab', cpu_percent: null,
          memory_used_gib: 4, memory_total_gib: 8 }, guests: [],
      } } })
    render(<ObservatoryModal open onClose={() => {}} />)
    expect(await screen.findByText('Unknown')).toBeInTheDocument()
    expect(screen.getByText('50.0%')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('stale')
    expect(screen.getByRole('link', { name: /Operations/ })).toHaveAttribute('href', 'https://monitor.example.com/operations')
  })
  it('shows unavailable without leaking remote errors and can retry', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('private token detail'))
    render(<ObservatoryModal open onClose={() => {}} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('unavailable')
    expect(screen.queryByText(/private token/)).not.toBeInTheDocument()
    vi.mocked(api.get).mockResolvedValue({ data: { enabled: false } })
    fireEvent.click(screen.getByRole('button', { name: 'Refresh measurements' }))
    expect(await screen.findByText(/Not connected/)).toBeInTheDocument()
  })
})

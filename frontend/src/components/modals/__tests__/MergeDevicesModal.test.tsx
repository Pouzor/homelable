import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MergeDevicesModal } from '../MergeDevicesModal'
import type { InventoryEntry } from '@/types'

const devices = [
  {
    id: 'proxmox', label: 'n8n', ip: '192.168.1.62', mac: 'bc:24:11:95:af:8c',
    ieee_address: 'pve-proxmox-ai-130', status: 'pending', services: [],
    discovered_at: '2026-04-01T00:00:00Z',
  },
  {
    id: 'canvas', label: 'n8n', ip: '192.168.1.62', mac: 'bc:24:11:95:af:8c',
    status: 'approved', canvas_count: 1, services: [],
    discovered_at: '2026-08-01T00:00:00Z',
  },
  {
    id: 'stub', label: 'n8n', ip: null, mac: null, status: 'pending', services: [],
    discovered_at: '2026-08-10T00:00:00Z',
  },
] as unknown as InventoryEntry[]

const props = {
  open: true,
  devices,
  onCancel: vi.fn(),
  onConfirm: vi.fn(),
}

describe('MergeDevicesModal', () => {
  beforeEach(() => {
    props.onCancel.mockReset()
    props.onConfirm.mockReset()
  })

  it('renders nothing for a selection that cannot be merged', () => {
    const { container } = render(<MergeDevicesModal {...props} devices={[devices[0]]} />)
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })

  it('lists every selected row with its addresses', () => {
    render(<MergeDevicesModal {...props} />)
    expect(screen.getByText(/merge 3 devices into one/i)).toBeDefined()
    expect(screen.getAllByRole('radio')).toHaveLength(3)
    expect(screen.getByText(/pve-proxmox-ai-130/)).toBeDefined()
    // The row with no address says so rather than rendering an empty line.
    expect(screen.getByText('no address')).toBeDefined()
  })

  it('preselects the suggested survivor and merges into it', () => {
    render(<MergeDevicesModal {...props} />)
    const radios = screen.getAllByRole('radio') as HTMLInputElement[]
    expect(radios[0].checked).toBe(true)   // the IEEE-bearing row

    fireEvent.click(screen.getByRole('button', { name: /^merge into/i }))
    expect(props.onConfirm).toHaveBeenCalledWith('proxmox')
  })

  it('lets the user keep a different row instead', () => {
    render(<MergeDevicesModal {...props} />)
    fireEvent.click(screen.getAllByRole('radio')[1])

    fireEvent.click(screen.getByRole('button', { name: /^merge into/i }))
    expect(props.onConfirm).toHaveBeenCalledWith('canvas')
  })

  it('warns how many rows go, and that it cannot be undone', () => {
    render(<MergeDevicesModal {...props} />)
    expect(screen.getByText(/2 rows will be deleted/i)).toBeDefined()
    expect(screen.getByText(/cannot be undone/i)).toBeDefined()
  })

  it('disables both actions while the merge is in flight', () => {
    render(<MergeDevicesModal {...props} busy />)
    expect(screen.getByRole('button', { name: /merging/i })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: /cancel/i })).toHaveProperty('disabled', true)
    expect(props.onConfirm).not.toHaveBeenCalled()
  })

  it('cancels without merging', () => {
    render(<MergeDevicesModal {...props} />)
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(props.onCancel).toHaveBeenCalled()
    expect(props.onConfirm).not.toHaveBeenCalled()
  })
})

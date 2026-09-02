import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ProxmoxApproveModal } from '../ProxmoxApproveModal'
import type { InventoryEntry } from '@/types'

const host = {
  id: 'h1', label: 'pve1', type: 'proxmox', status: 'pending', services: [],
} as unknown as InventoryEntry

const guests = [
  { id: 'g1', label: 'web', type: 'vm', ip: '10.0.0.5', status: 'pending', services: [] },
  { id: 'g2', label: 'dns', type: 'lxc', ip: '10.0.0.6', status: 'pending', services: [] },
] as unknown as InventoryEntry[]

const props = {
  open: true,
  host,
  guests,
  onCancel: vi.fn(),
  onConfirm: vi.fn(),
}

describe('ProxmoxApproveModal', () => {
  beforeEach(() => {
    props.onCancel.mockReset()
    props.onConfirm.mockReset()
  })

  it('renders nothing without a host', () => {
    const { container } = render(<ProxmoxApproveModal {...props} host={null} />)
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })

  it('lists the guests and counts them in the confirm button', () => {
    render(<ProxmoxApproveModal {...props} />)
    expect(screen.getByText('web')).toBeDefined()
    expect(screen.getByText('dns')).toBeDefined()
    expect(screen.getByRole('button', { name: /add 3 to canvas/i })).toBeDefined()
  })

  it('defaults to bringing the guests along, nested', () => {
    render(<ProxmoxApproveModal {...props} />)
    fireEvent.click(screen.getByRole('button', { name: /add 3 to canvas/i }))
    expect(props.onConfirm).toHaveBeenCalledWith({ childIds: ['g1', 'g2'], mode: 'container' })
  })

  it('passes the linked mode when the user picks it', () => {
    render(<ProxmoxApproveModal {...props} />)
    fireEvent.click(screen.getByRole('radio', { name: /separate nodes linked to the host/i }))
    fireEvent.click(screen.getByRole('button', { name: /add 3 to canvas/i }))
    expect(props.onConfirm).toHaveBeenCalledWith({ childIds: ['g1', 'g2'], mode: 'linked' })
  })

  it('drops the guests — and the mode picker — when the box is unticked', () => {
    render(<ProxmoxApproveModal {...props} />)
    fireEvent.click(screen.getByRole('checkbox', { name: /also add its 2 guests/i }))
    expect(screen.queryByRole('radio', { name: /nested inside the host/i })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /add 1 to canvas/i }))
    expect(props.onConfirm).toHaveBeenCalledWith({ childIds: [], mode: 'linked' })
  })

  it('cancels without confirming', () => {
    render(<ProxmoxApproveModal {...props} />)
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(props.onCancel).toHaveBeenCalled()
    expect(props.onConfirm).not.toHaveBeenCalled()
  })
})

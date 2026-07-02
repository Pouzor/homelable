import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ConfirmAddToGroupModal } from '../ConfirmAddToGroupModal'

describe('ConfirmAddToGroupModal', () => {
  it('renders nothing when closed', () => {
    render(
      <ConfirmAddToGroupModal open={false} nodeLabel="Router" targetLabel="DMZ" onConfirm={vi.fn()} onCancel={vi.fn()} />,
    )
    expect(screen.queryByText('Add to group')).toBeNull()
  })

  it('shows node and group labels when open', () => {
    render(
      <ConfirmAddToGroupModal open nodeLabel="Router" targetLabel="DMZ" onConfirm={vi.fn()} onCancel={vi.fn()} />,
    )
    expect(screen.getByText('Router')).toBeDefined()
    expect(screen.getByText('DMZ')).toBeDefined()
  })

  it('calls onConfirm when the confirm button is clicked', () => {
    const onConfirm = vi.fn()
    render(
      <ConfirmAddToGroupModal open nodeLabel="Router" targetLabel="DMZ" onConfirm={onConfirm} onCancel={vi.fn()} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /add to group/i }))
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('calls onCancel when the cancel button is clicked', () => {
    const onCancel = vi.fn()
    render(
      <ConfirmAddToGroupModal open nodeLabel="Router" targetLabel="DMZ" onConfirm={vi.fn()} onCancel={onCancel} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('uses container wording when variant is container', () => {
    render(
      <ConfirmAddToGroupModal open variant="container" nodeLabel="VM" targetLabel="Proxmox" onConfirm={vi.fn()} onCancel={vi.fn()} />,
    )
    expect(screen.getByRole('button', { name: /add to container/i })).toBeDefined()
    expect(screen.queryByText('Add to group')).toBeNull()
  })
})

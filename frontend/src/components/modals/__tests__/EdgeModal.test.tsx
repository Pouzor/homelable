import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { EdgeModal } from '../EdgeModal'

describe('EdgeModal', () => {
  // ── Visibility ────────────────────────────────────────────────────────────

  it('renders nothing when closed', () => {
    const { container } = render(<EdgeModal open={false} onClose={vi.fn()} onSubmit={vi.fn()} />)
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })

  it('renders form when open', () => {
    render(<EdgeModal open onClose={vi.fn()} onSubmit={vi.fn()} />)
    expect(screen.getByText('Connect Nodes')).toBeDefined()
  })

  it('uses custom title when provided', () => {
    render(<EdgeModal open onClose={vi.fn()} onSubmit={vi.fn()} title="Edit Link" />)
    expect(screen.getByText('Edit Link')).toBeDefined()
  })

  // ── Submit button label ───────────────────────────────────────────────────

  it('shows "Connect" button when onDelete is not provided', () => {
    render(<EdgeModal open onClose={vi.fn()} onSubmit={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Connect' })).toBeDefined()
  })

  it('shows "Save" button when onDelete is provided', () => {
    render(<EdgeModal open onClose={vi.fn()} onSubmit={vi.fn()} onDelete={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Save' })).toBeDefined()
  })

  // ── Default submit ────────────────────────────────────────────────────────

  it('calls onSubmit with default ethernet type', () => {
    const onSubmit = vi.fn()
    const onClose = vi.fn()
    render(<EdgeModal open onClose={onClose} onSubmit={onSubmit} />)
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    expect(onSubmit).toHaveBeenCalledOnce()
    expect(onSubmit.mock.calls[0][0].type).toBe('ethernet')
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('calls onSubmit with label when filled', () => {
    const onSubmit = vi.fn()
    render(<EdgeModal open onClose={vi.fn()} onSubmit={onSubmit} />)
    fireEvent.change(screen.getByPlaceholderText('e.g. 1G, trunk...'), { target: { value: 'uplink' } })
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    expect(onSubmit.mock.calls[0][0].label).toBe('uplink')
  })

  it('omits label from payload when empty', () => {
    const onSubmit = vi.fn()
    render(<EdgeModal open onClose={vi.fn()} onSubmit={onSubmit} />)
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    expect(onSubmit.mock.calls[0][0].label).toBeUndefined()
  })

  // ── VLAN ID field ─────────────────────────────────────────────────────────

  it('does not show VLAN ID field for ethernet type', () => {
    render(<EdgeModal open onClose={vi.fn()} onSubmit={vi.fn()} />)
    expect(screen.queryByPlaceholderText('e.g. 20')).toBeNull()
  })

  it('submits integer vlan_id when type is vlan', () => {
    const onSubmit = vi.fn()
    render(<EdgeModal open onClose={vi.fn()} onSubmit={onSubmit} initial={{ type: 'vlan', vlan_id: 20 }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    expect(onSubmit.mock.calls[0][0].vlan_id).toBe(20)
  })

  it('omits vlan_id from payload for non-vlan types', () => {
    const onSubmit = vi.fn()
    render(<EdgeModal open onClose={vi.fn()} onSubmit={onSubmit} initial={{ type: 'wifi' }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    expect(onSubmit.mock.calls[0][0].vlan_id).toBeUndefined()
  })

  // ── Path style ────────────────────────────────────────────────────────────

  it('defaults to bezier path style', () => {
    const onSubmit = vi.fn()
    render(<EdgeModal open onClose={vi.fn()} onSubmit={onSubmit} />)
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    expect(onSubmit.mock.calls[0][0].path_style).toBe('bezier')
  })

  it('switches path style to smooth on click', () => {
    const onSubmit = vi.fn()
    render(<EdgeModal open onClose={vi.fn()} onSubmit={onSubmit} />)
    fireEvent.click(screen.getByText('Smooth step'))
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    expect(onSubmit.mock.calls[0][0].path_style).toBe('smooth')
  })

  // ── Animation select ──────────────────────────────────────────────────────

  it('animation defaults to None — animated omitted from payload', () => {
    const onSubmit = vi.fn()
    render(<EdgeModal open onClose={vi.fn()} onSubmit={onSubmit} />)
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    expect(onSubmit.mock.calls[0][0].animated).toBeUndefined()
  })

  it('selecting Snake sends animated: "snake"', () => {
    const onSubmit = vi.fn()
    render(<EdgeModal open onClose={vi.fn()} onSubmit={onSubmit} />)
    fireEvent.click(screen.getByText('Snake'))
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    expect(onSubmit.mock.calls[0][0].animated).toBe('snake')
  })

  it('selecting Flow sends animated: "flow"', () => {
    const onSubmit = vi.fn()
    render(<EdgeModal open onClose={vi.fn()} onSubmit={onSubmit} />)
    fireEvent.click(screen.getByText('Flow'))
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    expect(onSubmit.mock.calls[0][0].animated).toBe('flow')
  })

  it('selecting Basic sends animated: "basic"', () => {
    const onSubmit = vi.fn()
    render(<EdgeModal open onClose={vi.fn()} onSubmit={onSubmit} />)
    fireEvent.click(screen.getByText('Basic'))
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    expect(onSubmit.mock.calls[0][0].animated).toBe('basic')
  })

  it('pre-fills animation from initial "basic" string', () => {
    const onSubmit = vi.fn()
    render(<EdgeModal open onClose={vi.fn()} onSubmit={onSubmit} initial={{ animated: 'basic' }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    expect(onSubmit.mock.calls[0][0].animated).toBe('basic')
  })

  it('selecting None after Snake omits animated from payload', () => {
    const onSubmit = vi.fn()
    render(<EdgeModal open onClose={vi.fn()} onSubmit={onSubmit} />)
    fireEvent.click(screen.getByText('Snake'))
    fireEvent.click(screen.getByText('None'))
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    expect(onSubmit.mock.calls[0][0].animated).toBeUndefined()
  })

  it('pre-fills animation from initial "snake" string', () => {
    const onSubmit = vi.fn()
    render(<EdgeModal open onClose={vi.fn()} onSubmit={onSubmit} initial={{ animated: 'snake' }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    expect(onSubmit.mock.calls[0][0].animated).toBe('snake')
  })

  it('pre-fills animation from legacy initial true (backward compat)', () => {
    const onSubmit = vi.fn()
    render(<EdgeModal open onClose={vi.fn()} onSubmit={onSubmit} initial={{ animated: true }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    expect(onSubmit.mock.calls[0][0].animated).toBe('snake')
  })

  // ── Pre-fill ──────────────────────────────────────────────────────────────

  it('pre-fills label from initial prop', () => {
    render(<EdgeModal open onClose={vi.fn()} onSubmit={vi.fn()} initial={{ label: 'trunk' }} />)
    const input = screen.getByPlaceholderText('e.g. 1G, trunk...') as HTMLInputElement
    expect(input.value).toBe('trunk')
  })

  it('pre-fills path style from initial prop', () => {
    const onSubmit = vi.fn()
    render(<EdgeModal open onClose={vi.fn()} onSubmit={onSubmit} initial={{ path_style: 'smooth' }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    expect(onSubmit.mock.calls[0][0].path_style).toBe('smooth')
  })

  // ── Cancel & Delete ───────────────────────────────────────────────────────

  it('calls onClose when Cancel is clicked', () => {
    const onClose = vi.fn()
    render(<EdgeModal open onClose={onClose} onSubmit={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('shows Delete button when onDelete is provided', () => {
    render(<EdgeModal open onClose={vi.fn()} onSubmit={vi.fn()} onDelete={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDefined()
  })

  it('does not show Delete button without onDelete', () => {
    render(<EdgeModal open onClose={vi.fn()} onSubmit={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
  })

  it('calls onDelete and onClose when Delete is clicked', () => {
    const onDelete = vi.fn()
    const onClose = vi.fn()
    render(<EdgeModal open onClose={onClose} onSubmit={vi.fn()} onDelete={onDelete} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(onDelete).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
  })

  // ── Waypoints / Clear path ────────────────────────────────────────────────

  it('does not show Clear path button when onClearWaypoints is not provided', () => {
    render(<EdgeModal open onClose={vi.fn()} onSubmit={vi.fn()} initial={{ type: 'ethernet', waypoints: [{ x: 1, y: 2 }] }} />)
    expect(screen.queryByText(/Clear path/)).toBeNull()
  })

  it('does not show Clear path button when waypoints are empty', () => {
    render(<EdgeModal open onClose={vi.fn()} onSubmit={vi.fn()} onClearWaypoints={vi.fn()} initial={{ type: 'ethernet', waypoints: [] }} />)
    expect(screen.queryByText(/Clear path/)).toBeNull()
  })

  it('does not show Clear path button when no initial waypoints', () => {
    render(<EdgeModal open onClose={vi.fn()} onSubmit={vi.fn()} onClearWaypoints={vi.fn()} />)
    expect(screen.queryByText(/Clear path/)).toBeNull()
  })

  it('shows Clear path button with count when waypoints exist', () => {
    render(
      <EdgeModal
        open onClose={vi.fn()} onSubmit={vi.fn()} onClearWaypoints={vi.fn()}
        initial={{ type: 'ethernet', waypoints: [{ x: 1, y: 2 }, { x: 3, y: 4 }] }}
      />,
    )
    expect(screen.getByText('Clear path (2 points)')).toBeDefined()
  })

  it('shows singular "point" when only one waypoint', () => {
    render(
      <EdgeModal
        open onClose={vi.fn()} onSubmit={vi.fn()} onClearWaypoints={vi.fn()}
        initial={{ type: 'ethernet', waypoints: [{ x: 1, y: 2 }] }}
      />,
    )
    expect(screen.getByText('Clear path (1 point)')).toBeDefined()
  })

  it('calls onClearWaypoints and onClose when Clear path is clicked', () => {
    const onClearWaypoints = vi.fn()
    const onClose = vi.fn()
    render(
      <EdgeModal
        open onClose={onClose} onSubmit={vi.fn()} onClearWaypoints={onClearWaypoints}
        initial={{ type: 'ethernet', waypoints: [{ x: 1, y: 2 }] }}
      />,
    )
    fireEvent.click(screen.getByText('Clear path (1 point)'))
    expect(onClearWaypoints).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
  })
})

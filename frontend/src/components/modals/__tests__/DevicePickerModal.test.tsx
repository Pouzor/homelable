/**
 * The device picker dialog.
 *
 * A dropdown could not carry this list: a homelab inventory runs to hundreds of
 * rows, many of them named after the same host, and the names were clipped to
 * the width of the field below them. Search, addresses and an explicit create
 * button are the point of the component.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DevicePickerModal } from '../DevicePickerModal'
import type { InventoryEntry } from '@/types'

function makeDevice(over: Partial<InventoryEntry> = {}): InventoryEntry {
  return {
    id: 'dev-1',
    ip: null,
    mac: null,
    hostname: null,
    os: null,
    services: [],
    suggested_type: null,
    status: 'approved',
    discovered_at: '2026-01-01T00:00:00Z',
    ...over,
  }
}

const DEVICES = [
  makeDevice({ id: 'dev-1', label: 'proxmox-1', ip: '192.168.50.10' }),
  makeDevice({ id: 'dev-2', label: 'proxmox-1', ip: '192.168.50.11', mac: 'aa:bb:cc:dd:ee:ff' }),
  makeDevice({ id: 'dev-3', label: 'pihole', ip: '192.168.50.20' }),
  makeDevice({ id: 'dev-4', hostname: 'nas-8bay' }),
]

function renderPicker(props: Partial<Parameters<typeof DevicePickerModal>[0]> = {}) {
  const onPick = vi.fn()
  const onCreate = vi.fn()
  const onClose = vi.fn()
  render(
    <DevicePickerModal
      open
      devices={DEVICES}
      onPick={onPick}
      onCreate={onCreate}
      onClose={onClose}
      {...props}
    />,
  )
  return { onPick, onCreate, onClose }
}

const search = (value: string) =>
  fireEvent.change(screen.getByLabelText('Search devices'), { target: { value } })

describe('DevicePickerModal', () => {
  it('renders nothing when closed', () => {
    renderPicker({ open: false })
    expect(screen.queryByLabelText('Search devices')).not.toBeInTheDocument()
  })

  it('prints every address, so two rows with one name can be told apart', () => {
    renderPicker()
    expect(screen.getByText('192.168.50.10')).toBeInTheDocument()
    expect(screen.getByText('192.168.50.11 · aa:bb:cc:dd:ee:ff')).toBeInTheDocument()
  })

  it('falls back to the hostname when a row was never named', () => {
    renderPicker()
    expect(screen.getByRole('button', { name: /nas-8bay/ })).toBeInTheDocument()
  })

  it('searches names and addresses alike', () => {
    renderPicker()

    search('pih')
    expect(screen.getByRole('button', { name: /pihole/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /proxmox/ })).not.toBeInTheDocument()

    search('50.11')
    expect(screen.getByRole('button', { name: /192\.168\.50\.11/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /192\.168\.50\.10/ })).not.toBeInTheDocument()

    search('AA:BB')
    expect(screen.getByRole('button', { name: /192\.168\.50\.11/ })).toBeInTheDocument()
  })

  it('says when nothing matches, and when there is nothing to match', () => {
    const { onClose } = renderPicker()
    search('nope')
    expect(screen.getByText('No device matches "nope".')).toBeInTheDocument()

    onClose.mockClear()
    render(
      <DevicePickerModal
        open
        devices={[]}
        onPick={vi.fn()}
        onCreate={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByText('The Device Inventory is empty.')).toBeInTheDocument()
  })

  it('puts the row already linked first, then sorts by name', () => {
    renderPicker({ currentDeviceId: 'dev-3' })
    const names = screen
      .getAllByRole('button')
      .map((b) => b.textContent ?? '')
      .filter((t) => t.includes('proxmox') || t.includes('pihole') || t.includes('nas'))
    expect(names[0]).toContain('pihole')
  })

  it('hands back the device picked', () => {
    const { onPick } = renderPicker()
    fireEvent.click(screen.getByRole('button', { name: /pihole/ }))
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 'dev-3' }))
  })

  it('offers creating a separate device as its own action', () => {
    const { onCreate } = renderPicker()
    fireEvent.click(screen.getByRole('button', { name: /Create a separate device/ }))
    expect(onCreate).toHaveBeenCalled()
  })

  it('disables every choice while a row is being created', () => {
    renderPicker({ busy: true })
    expect(screen.getByRole('button', { name: /pihole/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Create a separate device/ })).toBeDisabled()
  })

  it('closes on cancel', () => {
    const { onClose } = renderPicker()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalled()
  })
})

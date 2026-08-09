/** Pointing a mount at another Device Inventory entry. */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DevicePickerModal } from '../components/DevicePickerModal'
import { useRackStore } from '../store'
import type { InventoryDevice } from '@/types'

const refreshInventory = vi.hoisted(() => vi.fn())

function makeEntry(overrides: Partial<InventoryDevice> = {}): InventoryDevice {
  return {
    id: 'inv1',
    label: 'nas-truenas',
    type: 'nas',
    discoverySource: 'arp',
    ip: '192.168.1.40',
    mac: 'aa:bb:cc:dd:ee:ff',
    hostname: 'nas.lan',
    os: null,
    services: [],
    status: 'online',
    nodeId: null,
    node: null,
    racked: false,
    suggestedFaceplateId: 'nas-2u',
    ...overrides,
  }
}

function seed(inventory: InventoryDevice[]) {
  useRackStore.setState({ inventory, refreshInventory })
}

beforeEach(() => {
  refreshInventory.mockClear()
  seed([])
})

describe('DevicePickerModal', () => {
  it('offers the Device Inventory, canvas node or not', async () => {
    // The whole point: a device no one ever approved onto a logical canvas is
    // still the record of a real box, and is what racks are built out of.
    seed([
      makeEntry(),
      makeEntry({ id: 'inv2', label: 'pve-01', ip: '192.168.1.10', nodeId: 'node2' }),
    ])
    render(<DevicePickerModal open onPick={vi.fn()} onClose={vi.fn()} />)

    expect(screen.getByText('nas-truenas')).toBeInTheDocument()
    expect(screen.getByText('pve-01')).toBeInTheDocument()
    expect(refreshInventory).toHaveBeenCalled()
  })

  it('hands the picked entry back', async () => {
    const onPick = vi.fn()
    seed([makeEntry()])
    render(<DevicePickerModal open onPick={onPick} onClose={vi.fn()} />)

    await userEvent.click(screen.getByText('nas-truenas'))
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 'inv1' }))
  })

  it('prints the source and the canvas, which tell look-alikes apart', () => {
    seed([
      makeEntry({
        discoverySource: 'rack',
        node: {
          id: 'node1',
          label: 'nas-truenas',
          type: 'nas',
          ip: '192.168.1.40',
          mac: null,
          hostname: null,
          os: null,
          checkMethod: 'ping',
          designId: 'd1',
          designName: 'Network Topology',
          lastSeen: null,
        },
      }),
    ])
    render(<DevicePickerModal open onPick={vi.fn()} onClose={vi.fn()} />)

    expect(screen.getByText(/Rack device/)).toBeInTheDocument()
    expect(screen.getByText(/Network Topology/)).toBeInTheDocument()
  })

  it('hides a device another plate already stands for, keeping the current one', () => {
    // One entry, one mount — but the mount being edited must still see its own.
    seed([
      makeEntry({ id: 'inv1', label: 'mine', racked: true }),
      makeEntry({ id: 'inv2', label: 'taken', racked: true }),
      makeEntry({ id: 'inv3', label: 'free' }),
    ])
    render(<DevicePickerModal open value="inv1" onPick={vi.fn()} onClose={vi.fn()} />)

    expect(screen.getByText('mine')).toBeInTheDocument()
    expect(screen.getByText('free')).toBeInTheDocument()
    expect(screen.queryByText('taken')).not.toBeInTheDocument()
  })

  it('searches name, IP, hostname and source', async () => {
    seed([makeEntry(), makeEntry({ id: 'inv2', label: 'pve-01', ip: '192.168.1.10', hostname: 'pve.lan' })])
    render(<DevicePickerModal open onPick={vi.fn()} onClose={vi.fn()} />)
    const search = screen.getByLabelText('Search devices')

    await userEvent.type(search, '192.168.1.10')
    expect(screen.queryByText('nas-truenas')).not.toBeInTheDocument()
    expect(screen.getByText('pve-01')).toBeInTheDocument()

    await userEvent.clear(search)
    await userEvent.type(search, 'pve.lan')
    expect(screen.getByText('pve-01')).toBeInTheDocument()

    await userEvent.clear(search)
    await userEvent.type(search, 'network scan')
    expect(screen.getByText('nas-truenas')).toBeInTheDocument()
  })

  it('points at the Device Inventory when it is empty', () => {
    render(<DevicePickerModal open onPick={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByText(/The Device Inventory is empty/)).toBeInTheDocument()
  })

  it('says a search matched nothing, which is not the same thing', async () => {
    seed([makeEntry()])
    render(<DevicePickerModal open onPick={vi.fn()} onClose={vi.fn()} />)

    await userEvent.type(screen.getByLabelText('Search devices'), 'nothing')
    expect(screen.getByText('No device matches that search.')).toBeInTheDocument()
  })

  it('does not refetch while closed', () => {
    render(<DevicePickerModal open={false} onPick={vi.fn()} onClose={vi.fn()} />)
    expect(refreshInventory).not.toHaveBeenCalled()
  })
})

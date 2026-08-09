/** The logical-canvas facts printed beside a mount's ports. */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LinkedDevicePanel } from '../components/LinkedDevicePanel'
import type { InventoryDevice } from '@/types'

function makeEntry(overrides: Partial<InventoryDevice> = {}): InventoryDevice {
  return {
    id: 'inv1',
    label: 'nas',
    type: 'nas',
    ip: '192.168.1.9',
    mac: 'aa:bb:cc:dd:ee:ff',
    hostname: 'nas.lan',
    os: 'TrueNAS',
    services: [{ port: 445, name: 'smb' }],
    status: 'online',
    nodeId: 'node1',
    node: {
      id: 'node1',
      label: 'nas-truenas',
      type: 'nas',
      ip: '192.168.1.9',
      mac: 'aa:bb:cc:dd:ee:ff',
      hostname: 'nas.lan',
      os: 'TrueNAS SCALE',
      checkMethod: 'http',
      designId: 'd1',
      designName: 'Network',
      lastSeen: null,
    },
    racked: true,
    suggestedFaceplateId: 'nas-2u',
    ...overrides,
  }
}

describe('LinkedDevicePanel', () => {
  it('renders nothing for a mount with no inventory entry', () => {
    const { container } = render(<LinkedDevicePanel entry={null} status="unknown" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('prints the linked node facts and its services', () => {
    render(<LinkedDevicePanel entry={makeEntry()} status="online" />)

    expect(screen.getByText('nas-truenas')).toBeInTheDocument()
    expect(screen.getByText('192.168.1.9')).toBeInTheDocument()
    expect(screen.getByText('aa:bb:cc:dd:ee:ff')).toBeInTheDocument()
    expect(screen.getByText('nas.lan')).toBeInTheDocument()
    expect(screen.getByText('http')).toBeInTheDocument()
    expect(screen.getByText('Network')).toBeInTheDocument()
    expect(screen.getByText('smb:445')).toBeInTheDocument()
  })

  it('prefers the node value over the inventory row it disagrees with', () => {
    // The node is what the user curates; the inventory row is what discovery
    // last saw, and it goes stale after a rename or a DHCP move.
    const entry = makeEntry({
      ip: '192.168.1.99',
      node: { ...makeEntry().node!, ip: '192.168.1.9' },
    })
    render(<LinkedDevicePanel entry={entry} status="online" />)

    expect(screen.getByText('192.168.1.9')).toBeInTheDocument()
    expect(screen.queryByText('192.168.1.99')).not.toBeInTheDocument()
  })

  it('still prints what discovery found when the device is on no canvas', () => {
    // The inventory row is the record of a real box whether or not anyone ever
    // drew it on a canvas — only the canvas-side rows go missing.
    render(<LinkedDevicePanel entry={makeEntry({ nodeId: null, node: null })} status="unknown" />)

    expect(screen.getByText('192.168.1.9')).toBeInTheDocument()
    expect(screen.getByText('TrueNAS')).toBeInTheDocument()
    expect(screen.getByText('smb:445')).toBeInTheDocument()
    // No node means no check to follow and no canvas to name.
    expect(screen.getByText('Not on a logical canvas.')).toBeInTheDocument()
    expect(screen.queryByText('Canvas')).not.toBeInTheDocument()
  })

  it('offers no link when relinking is not on offer', () => {
    // A mount that does not exist yet has nothing to hang a link on.
    render(<LinkedDevicePanel entry={makeEntry({ nodeId: null, node: null })} status="unknown" />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('lets a mount be pointed at another device', async () => {
    // The device behind a plate can be picked wrong — a placeholder, or the
    // wrong twin of two look-alikes — so the panel must not be a dead end.
    const onLink = vi.fn()
    render(<LinkedDevicePanel entry={makeEntry()} status="online" onLink={onLink} />)

    await userEvent.click(screen.getByRole('button', { name: /Link to another device/ }))
    expect(onLink).toHaveBeenCalled()
  })

  it('shows the status it was handed, not the inventory row own', () => {
    // The plate resolves `auto` through the inventory; the panel must agree with
    // the LED next to it rather than resolve a second time.
    render(<LinkedDevicePanel entry={makeEntry()} status="offline" />)
    expect(screen.getByText('offline')).toBeInTheDocument()
  })

  it('skips the rows nothing knows about', () => {
    const bare: InventoryDevice = {
      id: 'inv2',
      // A row discovery could not even name — nothing to fall back on.
      label: '',
      type: null,
      status: 'unknown',
      nodeId: 'node2',
      // A node exists, and holds nothing worth printing.
      node: {
        id: 'node2',
        label: null,
        type: null,
        ip: null,
        mac: null,
        hostname: null,
        os: null,
        checkMethod: null,
        designId: null,
        designName: null,
        lastSeen: null,
      },
      racked: false,
      suggestedFaceplateId: 'patch-24',
    }
    render(<LinkedDevicePanel entry={bare} status="unknown" />)

    expect(screen.getByText(/Nothing known about this device yet/)).toBeInTheDocument()
    expect(screen.queryByText('IP')).not.toBeInTheDocument()
    expect(screen.queryByText('Services')).not.toBeInTheDocument()
  })

  it('prints a last-seen timestamp only when it parses', () => {
    const node = makeEntry().node!
    render(<LinkedDevicePanel entry={makeEntry({ node: { ...node, lastSeen: 'not-a-date' } })} status="online" />)
    expect(screen.queryByText('Last seen')).not.toBeInTheDocument()
  })
})

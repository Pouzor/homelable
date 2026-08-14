/**
 * The rail a selected cable opens: physical facts up top, then the same
 * property records the logical canvas uses for nodes.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { RackCablePanel } from '../components/RackCablePanel'
import { CABLE_COLORS } from '../rackDefaults'
import { useRackStore } from '../store'

vi.mock('sonner', async () => (await import('@/test/mocks')).mockSonner())

const store = () => useRackStore.getState()
const selected = () => store().cables.find((c) => c.id === store().selectedCableId)!

beforeEach(() => {
  store().loadDemo()
})

describe('RackCablePanel', () => {
  it('renders nothing until a cable is selected', () => {
    const { container } = render(<RackCablePanel />)
    expect(container).toBeEmptyDOMElement()
  })

  it('names both endpoints by device and port', () => {
    const cable = store().cables[0]
    store().selectCable(cable.id)
    const device = store().devices.find((d) => d.id === cable.from.deviceId)!
    const port = device.ports.find((p) => p.id === cable.from.portId)!

    render(<RackCablePanel />)
    expect(screen.getAllByTitle(device.label).length).toBeGreaterThan(0)
    expect(screen.getAllByTitle(port.label).length).toBeGreaterThan(0)
  })

  it('edits the label and toggles printing it on the canvas', () => {
    store().selectCable(store().cables[0].id)
    render(<RackCablePanel />)

    fireEvent.change(screen.getByLabelText('Cable label'), { target: { value: 'Uplink' } })
    expect(selected().label).toBe('Uplink')

    fireEvent.click(screen.getByRole('checkbox'))
    expect(selected().labelVisible).toBe(true)
  })

  it('recolours from a swatch and from the hex field', () => {
    store().selectCable(store().cables[0].id)
    render(<RackCablePanel />)

    fireEvent.click(screen.getByLabelText('Cable colour #a855f7'))
    expect(selected().color).toBe('#a855f7')

    const hex = screen.getByLabelText('Cable colour hex')
    fireEvent.change(hex, { target: { value: '#123456' } })
    fireEvent.blur(hex)
    expect(selected().color).toBe('#123456')
  })

  it('leaves the cable alone while a hex is half-typed', () => {
    // "#39d" parses as a colour, but "#3" does not — a per-keystroke write fed
    // the SVG stroke junk and the run stopped rendering.
    const cable = store().cables[0]
    store().selectCable(cable.id)
    render(<RackCablePanel />)

    fireEvent.change(screen.getByLabelText('Cable colour hex'), { target: { value: '#12' } })
    expect(selected().color).toBe(cable.color)
  })

  it('falls back to the type default when the hex does not parse', () => {
    const cable = store().cables.find((c) => c.type === 'ethernet')!
    store().selectCable(cable.id)
    render(<RackCablePanel />)

    const hex = screen.getByLabelText('Cable colour hex')
    fireEvent.change(hex, { target: { value: 'zzz' } })
    fireEvent.blur(hex)

    expect(selected().color).toBe(CABLE_COLORS.ethernet)
  })

  it('accepts the three-digit shorthand', () => {
    store().selectCable(store().cables[0].id)
    render(<RackCablePanel />)

    const hex = screen.getByLabelText('Cable colour hex')
    fireEvent.change(hex, { target: { value: '#abc' } })
    fireEvent.blur(hex)

    expect(selected().color).toBe('#abc')
  })

  it('recolours a default-coloured cable when its type changes', () => {
    const ethernet = store().cables.find((c) => c.type === 'ethernet')!
    store().updateCable(ethernet.id, { color: CABLE_COLORS.ethernet })
    store().selectCable(ethernet.id)
    render(<RackCablePanel />)

    fireEvent.click(screen.getByText('Fibre'))
    expect(selected().type).toBe('fiber')
    expect(selected().color).toBe(CABLE_COLORS.fiber)
  })

  it('keeps a hand-picked colour across a type change', () => {
    const ethernet = store().cables.find((c) => c.type === 'ethernet')!
    store().updateCable(ethernet.id, { color: '#ff00ff' })
    store().selectCable(ethernet.id)
    render(<RackCablePanel />)

    fireEvent.click(screen.getByText('Fibre'))
    expect(selected().type).toBe('fiber')
    expect(selected().color).toBe('#ff00ff')
  })

  it('adds a property through a suggestion and stores it on the cable', () => {
    store().selectCable(store().cables[0].id)
    render(<RackCablePanel />)

    fireEvent.click(screen.getByText('+ Length'))
    fireEvent.change(screen.getByPlaceholderText(/^Value/), { target: { value: '2 m' } })
    // Two buttons read "Add": the section's, then the form's confirm.
    const addButtons = screen.getAllByRole('button', { name: 'Add' })
    fireEvent.click(addButtons[addButtons.length - 1])

    expect(selected().properties).toEqual([
      { key: 'Length', value: '2 m', icon: null, visible: true },
    ])
  })

  it('hides a property from the canvas without deleting it', () => {
    const cable = store().cables[0]
    store().updateCable(cable.id, {
      properties: [{ key: 'VLAN', value: '20', icon: null, visible: true }],
    })
    store().selectCable(cable.id)
    render(<RackCablePanel />)

    fireEvent.click(screen.getByTitle('Hide on canvas'))
    expect(selected().properties).toEqual([
      { key: 'VLAN', value: '20', icon: null, visible: false },
    ])
  })

  it('unplugs the cable', () => {
    const cable = store().cables[0]
    store().selectCable(cable.id)
    render(<RackCablePanel />)

    fireEvent.click(screen.getByRole('button', { name: /Unplug cable/ }))
    expect(store().cables.some((c) => c.id === cable.id)).toBe(false)
    expect(store().selectedCableId).toBeNull()
  })

  it('closes without touching the cable', () => {
    const before = store().cables.length
    store().selectCable(store().cables[0].id)
    render(<RackCablePanel />)

    fireEvent.click(screen.getByLabelText('Close panel'))
    expect(store().selectedCableId).toBeNull()
    expect(store().cables).toHaveLength(before)
  })
})

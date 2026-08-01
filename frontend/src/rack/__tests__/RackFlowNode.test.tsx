/**
 * The rack draws a colour, never a mode: a mount set to "check device" reads
 * its LED from the Device Inventory's live `node_status`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { RackFlowNode } from '../components/RackFlowNode'
import { useRackStore } from '../store'
import { rackPalette } from '../rackTheme'
import { useThemeStore } from '@/stores/themeStore'
import { getFaceplate } from '../faceplates'
import type { NodeProps } from '@xyflow/react'

vi.mock('@xyflow/react', async () => {
  const { mockReactFlow } = await import('@/test/mocks')
  return mockReactFlow({ useReactFlow: () => ({ getZoom: () => 1 }) })
})

const store = () => useRackStore.getState()

beforeEach(() => {
  store().reset()
  store().loadDemo()
})

/** A mounted device whose plate actually draws a status LED. */
function ledDevice() {
  return store().devices.find((d) => d.deviceId && getFaceplate(d.faceplateId).statusLed)!
}

function renderRack() {
  const rackId = store().racks[0].id
  return render(<RackFlowNode {...({ id: rackId } as NodeProps)} />)
}

/** Whatever theme the app is on — the rack derives its colours from it. */
const palette = () => rackPalette(useThemeStore.getState().activeTheme)

/** The LED is the only circle the plate draws. */
function ledFill(label: string): string | null {
  const plate = screen.getByTitle(new RegExp(`^${label} ·`)).querySelector('svg')!
  return plate.querySelector('circle')!.getAttribute('fill')
}

describe('RackFlowNode status', () => {
  it('follows the inventory live status for an auto mount', () => {
    const device = ledDevice()
    useRackStore.setState({
      devices: store().devices.map((d) =>
        d.id === device.id ? { ...d, status: 'auto' as const } : d,
      ),
      inventory: store().inventory.map((i) =>
        i.id === device.deviceId ? { ...i, status: 'offline' as const } : i,
      ),
    })

    renderRack()
    expect(ledFill(device.label)).toBe(palette().status.offline)
  })

  it('keeps drawing a pinned status as-is', () => {
    const device = ledDevice()
    useRackStore.setState({
      devices: store().devices.map((d) =>
        d.id === device.id ? { ...d, status: 'online' as const } : d,
      ),
      inventory: store().inventory.map((i) =>
        i.id === device.deviceId ? { ...i, status: 'offline' as const } : i,
      ),
    })

    renderRack()
    expect(ledFill(device.label)).toBe(palette().status.online)
  })
})

describe('RackFlowNode patching', () => {
  /** Two mounted ports in this rack that nothing is plugged into yet. */
  function freePorts() {
    const patched = new Set(
      store().cables.flatMap((c) => [c.from.portId, c.to.portId]),
    )
    const found = store()
      .devices.filter((d) => d.rackId === store().racks[0].id)
      .flatMap((d) => d.ports.filter((p) => !patched.has(p.id)).map((p) => ({ device: d, port: p })))
    return { a: found[0], b: found[found.length - 1] }
  }

  /** The port's group, found through the <title> the plate gives it. */
  function portGroup(label: string, portLabel: string, portType: string) {
    const plate = screen.getByTitle(new RegExp(`^${label} ·`))
    const title = Array.from(plate.querySelectorAll('title')).find(
      (t) => t.textContent === `${portLabel} · ${portType}`,
    )
    if (!title) throw new Error(`no port ${portLabel} on ${label}`)
    return title.parentElement!
  }

  it('ignores a press on a port outside patch mode', () => {
    renderRack()
    const { a } = freePorts()
    fireEvent.pointerDown(portGroup(a.device.label, a.port.label, a.port.type))
    expect(store().cableDraft).toBeNull()
    expect(store().cableDrag).toBeNull()
  })

  it('patches a cable dragged from one port to another', () => {
    store().toggleCableMode()
    renderRack()
    const { a, b } = freePorts()
    const before = store().cables.length

    fireEvent.pointerDown(portGroup(a.device.label, a.port.label, a.port.type))
    expect(store().cableDraft).toEqual({ deviceId: a.device.id, portId: a.port.id })

    fireEvent.pointerUp(portGroup(b.device.label, b.port.label, b.port.type))
    expect(store().cables).toHaveLength(before + 1)
    const created = store().cables[store().cables.length - 1]
    expect(created.from.portId).toBe(a.port.id)
    expect(created.to.portId).toBe(b.port.id)
  })

  it('still patches with two separate clicks', () => {
    store().toggleCableMode()
    renderRack()
    const { a, b } = freePorts()
    const before = store().cables.length

    const portA = portGroup(a.device.label, a.port.label, a.port.type)
    fireEvent.pointerDown(portA)
    fireEvent.pointerUp(portA)
    expect(store().cableDraft).toEqual({ deviceId: a.device.id, portId: a.port.id })
    expect(store().cables).toHaveLength(before)

    fireEvent.pointerDown(portGroup(b.device.label, b.port.label, b.port.type))
    expect(store().cables).toHaveLength(before + 1)
  })
})

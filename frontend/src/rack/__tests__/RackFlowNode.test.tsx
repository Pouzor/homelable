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

describe('RackFlowNode plate opacity', () => {
  /** Every faceplate the rack draws, one <svg> each. */
  const plateOpacities = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('svg')).map((s) => s.style.opacity)

  it('keeps plates opaque with cables always on', () => {
    // A faded plate let the rails and the U grid show through the gear.
    store().setCableVisibility('always')
    const { container } = renderRack()
    expect(plateOpacities(container).every((o) => o === '')).toBe(true)
  })

  it('keeps plates opaque in patch mode too', () => {
    store().toggleCableMode()
    const { container } = renderRack()
    expect(plateOpacities(container).every((o) => o === '')).toBe(true)
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

describe('RackFlowNode port visibility', () => {
  /** How many sockets the plate of `label` is currently drawing. */
  function drawnPorts(label: string) {
    const plate = screen.getByTitle(new RegExp(`^${label} ·`))
    return Array.from(plate.querySelectorAll('title')).length
  }

  /** A cable between a switch and a non-patch plate, and both its ends. */
  function crossCable() {
    const sw = store().devices.find((d) => d.faceplateId === 'switch-24')!
    const cable = store().cables.find(
      (c) => c.from.deviceId === sw.id || c.to.deviceId === sw.id,
    )!
    const farId = cable.from.deviceId === sw.id ? cable.to.deviceId : cable.from.deviceId
    return { sw, cable, far: store().devices.find((d) => d.id === farId)! }
  }

  it('hides the ports of non-patch gear until it is hovered', () => {
    const { far } = crossCable()
    renderRack()
    expect(drawnPorts(far.label)).toBe(0)

    fireEvent.mouseEnter(screen.getByTitle(new RegExp(`^${far.label} ·`)))
    expect(drawnPorts(far.label)).toBe(far.ports.length)
  })

  it('draws the far socket of a cable revealed by hovering the switch', () => {
    // The reported bug: hovering the switch drew its runs, but the ends landed
    // on plates that draw nothing — a cable stopping on blank metal.
    const { sw, far } = crossCable()
    renderRack()

    fireEvent.mouseEnter(screen.getByTitle(new RegExp(`^${sw.label} ·`)))
    expect(drawnPorts(far.label)).toBeGreaterThan(0)
    // Only the patched one: hovering a neighbour does not reveal the whole plate.
    expect(drawnPorts(far.label)).toBeLessThan(far.ports.length)
  })

  it('draws no socket at all while the cabling overlay is hidden', () => {
    const { sw, far } = crossCable()
    store().setCableVisibility('hidden')
    renderRack()

    fireEvent.mouseEnter(screen.getByTitle(new RegExp(`^${sw.label} ·`)))
    expect(drawnPorts(far.label)).toBe(0)
  })

  it('obeys a mount that overrides when its ports show', () => {
    const { sw, far } = crossCable()
    useRackStore.setState({
      devices: store().devices.map((d) =>
        d.id === far.id
          ? { ...d, portVisibility: 'always' as const }
          : d.id === sw.id
            ? { ...d, portVisibility: 'hover' as const }
            : d,
      ),
    })
    renderRack()

    expect(drawnPorts(far.label)).toBe(far.ports.length)
    // A switch set to `hover` keeps only what a drawn cable ends on.
    expect(drawnPorts(sw.label)).toBeLessThan(sw.ports.length)
  })
})

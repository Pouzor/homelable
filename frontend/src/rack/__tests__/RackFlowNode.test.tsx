/**
 * The rack draws a colour, never a mode: a mount set to "check device" reads
 * its LED from the Device Inventory's live `node_status`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
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

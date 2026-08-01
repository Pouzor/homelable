/**
 * Rack header actions. The Unplug button is the visible half of cable
 * selection — the keyboard shortcut alone would be undiscoverable.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { RackToolbarActions } from '../RackToolbarActions'
import { useRackStore } from '@/rack/store'

vi.mock('sonner', async () => (await import('@/test/mocks')).mockSonner())

beforeEach(() => {
  useRackStore.getState().loadDemo()
})

const unplug = () => screen.queryByRole('button', { name: /unplug/i })

describe('RackToolbarActions cable selection', () => {
  it('hides Unplug outside patch mode', () => {
    useRackStore.getState().selectCable(useRackStore.getState().cables[0].id)
    render(<RackToolbarActions />)
    expect(unplug()).toBeNull()
  })

  it('hides Unplug in patch mode while no cable is selected', () => {
    useRackStore.getState().toggleCableMode()
    render(<RackToolbarActions />)
    expect(unplug()).toBeNull()
  })

  it('unplugs the selected cable', () => {
    useRackStore.getState().toggleCableMode()
    const cable = useRackStore.getState().cables[0]
    useRackStore.getState().selectCable(cable.id)
    render(<RackToolbarActions />)

    fireEvent.click(unplug()!)
    expect(useRackStore.getState().cables.some((c) => c.id === cable.id)).toBe(false)
    expect(unplug()).toBeNull()
  })
})

/**
 * Rack header actions. The Unplug button is the visible half of cable
 * selection — the keyboard shortcut alone would be undiscoverable.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RackToolbarActions } from '../RackToolbarActions'
import { useRackStore } from '@/rack/store'

vi.mock('sonner', async () => (await import('@/test/mocks')).mockSonner())

beforeEach(() => {
  useRackStore.getState().loadDemo()
})

const unplug = () => screen.queryByRole('button', { name: /unplug/i })

describe('RackToolbarActions cable visibility', () => {
  it('shows the active visibility on the trigger', () => {
    useRackStore.getState().setCableVisibility('always')
    render(<RackToolbarActions />)
    expect(screen.getByLabelText('Cable visibility')).toHaveTextContent('Cables always')
  })

  it('applies the picked visibility to the store', async () => {
    // base-ui commits its selection on real pointer sequences, not a bare click.
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    render(<RackToolbarActions />)

    await user.click(screen.getByLabelText('Cable visibility'))
    await user.click(await screen.findByRole('option', { name: 'Cables hidden' }))

    expect(useRackStore.getState().cableVisibility).toBe('hidden')
  })

  it('carries no cable type filter — copper and fibre always draw together', () => {
    render(<RackToolbarActions />)
    expect(screen.queryByLabelText('Cable type filter')).toBeNull()
    expect(screen.queryByText('All types')).toBeNull()
    expect('cableTypeFilter' in useRackStore.getState()).toBe(false)
  })
})

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

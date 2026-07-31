/** Rack settings moved out of the right rail into their own dialog. */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { RackSettingsModal } from '../components/RackSettingsModal'
import { useRackStore } from '../store'

vi.mock('sonner', async () => (await import('@/test/mocks')).mockSonner())

const store = () => useRackStore.getState()

beforeEach(() => {
  store().loadDemo()
})

describe('RackSettingsModal', () => {
  it('renders nothing until a rack is opened', () => {
    const { container } = render(<RackSettingsModal />)
    expect(container).toBeEmptyDOMElement()
  })

  it('edits name and capacity live', () => {
    store().openRackEditor('rack-main')
    render(<RackSettingsModal />)

    fireEvent.change(screen.getByLabelText('Rack name'), { target: { value: 'Garage' } })
    fireEvent.change(screen.getByLabelText('Rack height'), { target: { value: '24' } })

    const rack = store().racks.find((r) => r.id === 'rack-main')!
    expect(rack.name).toBe('Garage')
    expect(rack.uHeight).toBe(24)
  })

  it('reports how much of the rack is in use', () => {
    store().openRackEditor('rack-main')
    render(<RackSettingsModal />)
    expect(screen.getByText(/U used of 18U/)).toBeInTheDocument()
  })

  it('deletes the rack and closes', () => {
    store().openRackEditor('rack-main')
    render(<RackSettingsModal />)

    fireEvent.click(screen.getByRole('button', { name: 'Delete rack' }))

    expect(store().racks).toHaveLength(0)
    expect(store().devices).toHaveLength(0)
    expect(store().rackEditorId).toBeNull()
  })
})

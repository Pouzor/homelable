/** Rack settings moved out of the right rail into their own dialog. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { RackSettingsModal } from '../components/RackSettingsModal'
import { useRackStore } from '../store'

vi.mock('sonner', async () => (await import('@/test/mocks')).mockSonner())

const store = () => useRackStore.getState()

beforeEach(() => {
  store().loadDemo()
  // Deleting a rack takes its mounts and their patching with it, so the modal
  // asks first. Default to "yes" and let the tests that care say otherwise.
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('RackSettingsModal', () => {
  it('renders nothing until a rack is opened', () => {
    const { container } = render(<RackSettingsModal />)
    expect(container).toBeEmptyDOMElement()
  })

  it('edits name live and capacity on commit', () => {
    store().openRackEditor('rack-main')
    render(<RackSettingsModal />)

    fireEvent.change(screen.getByLabelText('Rack name'), { target: { value: 'Garage' } })
    const height = screen.getByLabelText('Rack height')
    fireEvent.change(height, { target: { value: '24' } })
    fireEvent.blur(height)

    const rack = store().racks.find((r) => r.id === 'rack-main')!
    expect(rack.name).toBe('Garage')
    expect(rack.uHeight).toBe(24)
  })

  it('reports how much of the rack is in use', () => {
    store().openRackEditor('rack-main')
    render(<RackSettingsModal />)
    expect(screen.getByText(/U used of 18U/)).toBeInTheDocument()
  })

  it('leaves the rack alone while the height is being typed', () => {
    // Backspacing "18" walks through "1", which would shrink the rack and
    // relocate every mount — a move nothing undoes when the digits come back.
    store().openRackEditor('rack-main')
    const before = store().devices.map((d) => ({ ...d }))
    render(<RackSettingsModal />)

    const height = screen.getByLabelText('Rack height')
    fireEvent.change(height, { target: { value: '1' } })

    expect(store().racks[0].uHeight).toBe(18)
    expect(store().devices).toEqual(before)
  })

  it('commits the height on Enter', () => {
    store().openRackEditor('rack-main')
    render(<RackSettingsModal />)

    const height = screen.getByLabelText('Rack height')
    fireEvent.change(height, { target: { value: '30' } })
    fireEvent.keyDown(height, { key: 'Enter' })
    fireEvent.blur(height)

    expect(store().racks[0].uHeight).toBe(30)
  })

  it('reverts the field when the shrink is refused', () => {
    store().openRackEditor('rack-main')
    render(<RackSettingsModal />)

    const height = screen.getByLabelText('Rack height')
    fireEvent.change(height, { target: { value: '1' } })
    fireEvent.blur(height)

    expect(store().racks[0].uHeight).toBe(18)
    expect((height as HTMLInputElement).value).toBe('18')
  })

  it('treats a blanked height as no edit', () => {
    // Number('') is 0, which used to fall through to 1 U: select-all, Delete,
    // click elsewhere, and an empty rack silently became 1 U with no undo.
    store().openRackEditor('rack-main')
    render(<RackSettingsModal />)

    const height = screen.getByLabelText('Rack height')
    fireEvent.change(height, { target: { value: '' } })
    fireEvent.blur(height)

    expect(store().racks[0].uHeight).toBe(18)
    expect((height as HTMLInputElement).value).toBe('18')
  })

  it('treats a blanked height as no edit on an empty rack too', () => {
    // The dangerous case: with no mounts, updateRack has nothing to refuse.
    const id = store().addRack({ name: 'Empty' })
    const height = () => store().racks.find((r) => r.id === id)!.uHeight
    const before = height()
    store().openRackEditor(id)
    render(<RackSettingsModal />)

    const field = screen.getByLabelText('Rack height')
    fireEvent.change(field, { target: { value: '' } })
    fireEvent.blur(field)

    expect(height()).toBe(before)
  })

  it('ignores a height that does not parse', () => {
    store().openRackEditor('rack-main')
    render(<RackSettingsModal />)

    const height = screen.getByLabelText('Rack height')
    fireEvent.change(height, { target: { value: 'abc' } })
    fireEvent.blur(height)

    expect(store().racks[0].uHeight).toBe(18)
  })

  it('commits nothing when the dialog closes on a typed height', () => {
    // Escape closes the dialog; the uncommitted draft dies with the field.
    store().openRackEditor('rack-main')
    render(<RackSettingsModal />)

    fireEvent.change(screen.getByLabelText('Rack height'), { target: { value: '5' } })
    fireEvent.keyDown(screen.getByLabelText('Rack height'), { key: 'Escape' })

    expect(store().racks[0].uHeight).toBe(18)
  })

  it('deletes the rack and closes once confirmed', () => {
    store().openRackEditor('rack-main')
    render(<RackSettingsModal />)

    fireEvent.click(screen.getByRole('button', { name: 'Delete rack' }))

    expect(window.confirm).toHaveBeenCalled()
    expect(store().racks).toHaveLength(0)
    expect(store().devices).toHaveLength(0)
    expect(store().rackEditorId).toBeNull()
  })

  it('keeps the rack when the delete is declined', () => {
    vi.mocked(window.confirm).mockReturnValue(false)
    store().openRackEditor('rack-main')
    const mounted = store().devices.length
    render(<RackSettingsModal />)

    fireEvent.click(screen.getByRole('button', { name: 'Delete rack' }))

    expect(store().racks).toHaveLength(1)
    expect(store().devices).toHaveLength(mounted)
    expect(store().rackEditorId).toBe('rack-main')
  })

  it('counts the mounts it is about to unmount in the warning', () => {
    store().openRackEditor('rack-main')
    const mounted = store().devices.filter((d) => d.rackId === 'rack-main').length
    render(<RackSettingsModal />)

    fireEvent.click(screen.getByRole('button', { name: 'Delete rack' }))

    expect(vi.mocked(window.confirm).mock.calls[0][0]).toContain(`${mounted} device`)
  })
})

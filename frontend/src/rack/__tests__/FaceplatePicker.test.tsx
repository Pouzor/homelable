/**
 * The picker is the only place the faceplate catalog is browsable, so it has to
 * show every template, filter honestly and report the pick.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { FaceplatePicker } from '../components/FaceplatePicker'
import { FACEPLATES, faceplateGroups } from '../faceplates'

function setup(props: Partial<React.ComponentProps<typeof FaceplatePicker>> = {}) {
  const onPick = vi.fn()
  const onClose = vi.fn()
  render(
    <FaceplatePicker open value="server-1u" onPick={onPick} onClose={onClose} {...props} />,
  )
  return { onPick, onClose }
}

describe('FaceplatePicker', () => {
  it('renders a tile for every template, grouped', () => {
    setup()
    for (const plate of FACEPLATES) {
      expect(screen.getByRole('button', { name: plate.label })).toBeInTheDocument()
    }
    for (const { group } of faceplateGroups()) {
      expect(screen.getByText(group)).toBeInTheDocument()
    }
  })

  it('draws each plate rather than listing its name only', () => {
    setup()
    const tile = screen.getByRole('button', { name: 'Switch 24 ports + 2 SFP' })
    expect(tile.querySelector('svg')).toBeInTheDocument()
    // Height and width read from the template, so sizes compare across tiles.
    expect(within(tile).getByText(/^1U · Full width · 26 ports$/)).toBeInTheDocument()
  })

  it('marks the applied plate as selected', () => {
    setup({ value: 'nas-2u' })
    expect(screen.getByRole('button', { name: 'NAS 2U — 8 bays' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: 'Server 1U' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  it('filters on name and on category', () => {
    setup()
    fireEvent.change(screen.getByLabelText('Search faceplates'), { target: { value: 'switch' } })
    expect(screen.getByRole('button', { name: 'Switch 8 ports' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'NAS 2U — 8 bays' })).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Search faceplates'), { target: { value: 'power' } })
    expect(screen.getByRole('button', { name: 'PDU 1U — 8 outlets' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Switch 8 ports' })).not.toBeInTheDocument()
  })

  it('says so when nothing matches', () => {
    setup()
    fireEvent.change(screen.getByLabelText('Search faceplates'), { target: { value: 'zzz' } })
    expect(screen.getByText(/No faceplate matches/)).toBeInTheDocument()
  })

  it('restricts the catalog to a kind', () => {
    setup({ kind: 'accessory' })
    expect(screen.getByRole('button', { name: 'Blank panel 1U' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Server 1U' })).not.toBeInTheDocument()
  })

  it('reports the pick and closes', () => {
    const { onPick, onClose } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Router / firewall 1U' }))
    expect(onPick).toHaveBeenCalledWith('router-1u')
    expect(onClose).toHaveBeenCalled()
  })

  it('renders nothing while closed', () => {
    setup({ open: false })
    expect(screen.queryByRole('button', { name: 'Server 1U' })).not.toBeInTheDocument()
  })
})

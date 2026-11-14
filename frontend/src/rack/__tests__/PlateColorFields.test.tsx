/**
 * The colour rows shared by the rack modal and the inventory editor: unset reads
 * "Auto", a pick writes the hex, Reset clears it, and the port bay is offered
 * only on plates that have one.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PlateColorFields, type PlateColors } from '../components/PlateColorFields'

const none: PlateColors = { color: null, textColor: null, bayColor: null }

function draw(faceplateId: string, value: PlateColors = none) {
  const onChange = vi.fn()
  render(<PlateColorFields faceplateId={faceplateId} value={value} onChange={onChange} />)
  return onChange
}

describe('PlateColorFields', () => {
  it('reads Auto for every colour left unset, with nothing to reset', () => {
    draw('patch-24')
    expect(screen.getAllByText('Auto')).toHaveLength(3)
    expect(screen.queryByRole('button', { name: /reset/i })).toBeNull()
  })

  it('offers the port bay only on a plate that has one', () => {
    draw('server-1u')
    expect(screen.getByLabelText('Colour override')).toBeInTheDocument()
    expect(screen.getByLabelText('Label colour')).toBeInTheDocument()
    expect(screen.queryByLabelText('Port bay colour')).toBeNull()
  })

  it('writes a picked colour to its own key', () => {
    const onChange = draw('patch-24')
    fireEvent.change(screen.getByLabelText('Label colour'), { target: { value: '#111111' } })
    expect(onChange).toHaveBeenLastCalledWith({ textColor: '#111111' })
    fireEvent.change(screen.getByLabelText('Port bay colour'), { target: { value: '#cccccc' } })
    expect(onChange).toHaveBeenLastCalledWith({ bayColor: '#cccccc' })
  })

  it('prints a set colour and clears it back to automatic', () => {
    const onChange = draw('patch-24', { ...none, textColor: '#111111' })
    expect(screen.getByText('#111111')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reset label colour' }))
    expect(onChange).toHaveBeenLastCalledWith({ textColor: null })
  })

  it('opens the picker on the colour Auto resolves to: dark ink on a white panel', () => {
    draw('patch-24', { ...none, color: '#ffffff' })
    expect(screen.getByLabelText('Label colour')).toHaveValue('#0d1117')
  })

  it('widens a stored #rgb for the native picker', () => {
    draw('patch-24', { ...none, bayColor: '#abc' })
    expect(screen.getByLabelText('Port bay colour')).toHaveValue('#aabbcc')
  })
})

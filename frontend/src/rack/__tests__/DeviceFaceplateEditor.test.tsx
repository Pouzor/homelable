/**
 * The device's front panel, edited away from any rack — the editor the Device
 * Inventory embeds.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DeviceFaceplateEditor } from '../components/DeviceFaceplateEditor'
import { emptyRackModel, type DeviceRackModel } from '../deviceRackModel'
import { getFaceplate } from '../faceplates'
import { RACK_COLUMNS } from '@/types'

const model: DeviceRackModel = {
  faceplateId: 'switch-24',
  uHeight: 1,
  colSpan: RACK_COLUMNS,
  color: null,
  ports: [{ id: 'p1', label: 'eth0', type: 'rj45', x: 0.2, y: 0.5 }],
}

function draw(over: Partial<React.ComponentProps<typeof DeviceFaceplateEditor>> = {}) {
  const onChange = vi.fn()
  render(
    <DeviceFaceplateEditor
      value={model}
      label="sw-01"
      status="online"
      editable
      onChange={onChange}
      {...over}
    />,
  )
  return { onChange }
}

describe('emptyRackModel', () => {
  it('takes its size from the plate, so a new model is never 0U', () => {
    const plate = getFaceplate('server-2u-bays')
    expect(emptyRackModel('server-2u-bays')).toEqual({
      faceplateId: 'server-2u-bays',
      uHeight: plate.uHeight,
      colSpan: plate.colSpan,
      color: null,
      ports: [],
    })
  })
})

describe('DeviceFaceplateEditor', () => {
  it('offers nothing to edit in read-only mode, only the plate and its summary', () => {
    draw({ editable: false })

    expect(screen.getByTestId('faceplate-stage')).toBeInTheDocument()
    expect(screen.queryByLabelText('Faceplate')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Add port' })).toBeNull()
    expect(screen.getByText(/Switch 24 ports.*1U.*1 port$/)).toBeInTheDocument()
  })

  it('edits the ports through the same list the rack modal uses', () => {
    const { onChange } = draw()
    fireEvent.change(screen.getByLabelText('Port eth0 label'), { target: { value: 'wan' } })

    expect(onChange.mock.calls.at(-1)![0].ports[0].label).toBe('wan')
  })

  it('reseeds the size from the plate that was picked, and keeps the ports', () => {
    const { onChange } = draw()
    fireEvent.click(screen.getByLabelText('Faceplate'))
    fireEvent.click(screen.getByRole('button', { name: /Server 2U — 8 bays/ }))

    const next = onChange.mock.calls.at(-1)![0] as DeviceRackModel
    expect(next.faceplateId).toBe('server-2u-bays')
    expect(next.uHeight).toBe(getFaceplate('server-2u-bays').uHeight)
    // The ports belong to the device, not to the plate it happens to wear.
    expect(next.ports).toEqual(model.ports)
  })

  it('clamps a typed height to what a rack can hold', () => {
    const { onChange } = draw()
    fireEvent.change(screen.getByLabelText('Height (U)'), { target: { value: '999' } })

    expect(onChange.mock.calls.at(-1)![0].uHeight).toBe(48)
  })

  it('clears the colour override rather than writing a default hex', () => {
    const { onChange } = draw({ value: { ...model, color: '#ff6e00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))

    expect(onChange.mock.calls.at(-1)![0].color).toBeNull()
  })
})

/**
 * The renderer places the name band and the status LED; a template can move
 * both off mid-height, which is what makes a desktop NAS look like one.
 */
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { Faceplate } from '../components/Faceplate'
import { getFaceplate } from '../faceplates'

const HEIGHT = 100

function draw(faceplateId: string) {
  const plate = getFaceplate(faceplateId)
  const { container } = render(
    <Faceplate
      faceplateId={faceplateId}
      label="nas-01"
      status="online"
      ports={plate.ports.map((p, i) => ({ ...p, id: `p${i}` }))}
      width={200}
      height={HEIGHT}
      revealed
    />,
  )
  return {
    led: container.querySelector('circle'),
    text: container.querySelector('text'),
  }
}

describe('Faceplate — name band', () => {
  it('keeps rack gear labelled across the middle', () => {
    const { led, text } = draw('server-1u')
    expect(led).toHaveAttribute('cy', String(HEIGHT / 2))
    expect(text).toHaveAttribute('y', String(HEIGHT / 2))
  })

  it('drops the badge and the LED to the bottom strip of a desktop NAS', () => {
    const band = getFaceplate('nas-desktop-2').labelBox.y!
    const { led, text } = draw('nas-desktop-2')
    // Drive trays own the height; the badge belongs under them, not across them.
    expect(led).toHaveAttribute('cy', String(band * HEIGHT))
    expect(text).toHaveAttribute('y', String(band * HEIGHT))
  })
})

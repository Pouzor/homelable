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

/** Every RJ45 silhouette drawn on a plate, as its path `d`. */
function rj45Paths(faceplateId: string, height: number) {
  const plate = getFaceplate(faceplateId)
  const ports = plate.ports.map((p, i) => ({ ...p, id: `p${i}` }))
  const { container } = render(
    <Faceplate
      faceplateId={faceplateId}
      label="gear"
      status="online"
      ports={ports}
      width={400}
      height={height}
      revealed
    />,
  )
  return Array.from(container.querySelectorAll('g'))
    .filter((g) => g.querySelector('title')?.textContent?.endsWith('· rj45'))
    .map((g) => g.querySelector('path')?.getAttribute('d'))
    .filter(Boolean)
}

describe('Faceplate — port artwork', () => {
  it('draws every RJ45 at the same size, whatever the plate', () => {
    // A 1U switch, a 1U patch panel and a 4U NAS: same socket on all three.
    const reference = rj45Paths('switch-24', 24)[0]
    expect(reference).toBeTruthy()
    for (const [id, height] of [
      ['patch-24', 24],
      ['server-1u', 24],
      ['nas-2u', 48],
      ['server-4u-storage', 96],
    ] as const) {
      const paths = rj45Paths(id, height)
      expect(paths.length).toBeGreaterThan(0)
      for (const d of paths) expect(d).toBe(reference)
    }
  })

  it('keeps the socket the same size on a plate stretched to 4U', () => {
    expect(rj45Paths('switch-24', 96)[0]).toBe(rj45Paths('switch-24', 24)[0])
  })
})

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

/** Ids of the ports the plate actually drew. */
function drawnPortIds(props: Partial<Parameters<typeof Faceplate>[0]>) {
  const ports = [
    { id: 'a', label: 'p1', type: 'rj45' as const, x: 0.3, y: 0.5 },
    { id: 'b', label: 'p2', type: 'rj45' as const, x: 0.5, y: 0.5 },
  ]
  const { container } = render(
    <Faceplate
      faceplateId="server-1u"
      label="box"
      status="online"
      ports={ports}
      width={200}
      height={24}
      {...props}
    />,
  )
  return Array.from(container.querySelectorAll('title'))
    .map((t) => t.textContent?.split(' ·')[0])
    .filter(Boolean)
}

describe('Faceplate — when ports are drawn', () => {
  it('hides the ports of non-patch gear until it is focused', () => {
    expect(drawnPortIds({})).toEqual([])
    expect(drawnPortIds({ revealed: true })).toEqual(['p1', 'p2'])
  })

  it('always draws a port a visible cable ends on, focused or not', () => {
    // The far end of a hovered device's run lands on a plate that is not
    // hovered — a cable must never end on an invisible socket.
    expect(drawnPortIds({ revealedPortIds: new Set(['b']) })).toEqual(['p2'])
  })

  it('honours an `always` override on gear the plate would hide', () => {
    expect(drawnPortIds({ portVisibility: 'always' })).toEqual(['p1', 'p2'])
  })

  it('honours a `hover` override on a switch the plate would always show', () => {
    const asSwitch = { faceplateId: 'switch-24' as const }
    expect(drawnPortIds({ ...asSwitch })).toEqual(['p1', 'p2'])
    expect(drawnPortIds({ ...asSwitch, portVisibility: 'hover' })).toEqual([])
    expect(drawnPortIds({ ...asSwitch, portVisibility: 'hover', revealed: true })).toEqual([
      'p1',
      'p2',
    ])
  })

  it('leaves `auto` on the faceplate to decide', () => {
    expect(drawnPortIds({ portVisibility: 'auto' })).toEqual([])
    expect(drawnPortIds({ portVisibility: 'auto', faceplateId: 'switch-24' })).toEqual([
      'p1',
      'p2',
    ])
  })
})

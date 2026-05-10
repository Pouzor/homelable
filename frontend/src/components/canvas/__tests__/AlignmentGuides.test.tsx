import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { AlignmentGuides } from '../AlignmentGuides'
import type { Guide } from '@/utils/alignment'

vi.mock('@xyflow/react', () => ({
  useViewport: () => ({ x: 50, y: 100, zoom: 2 }),
}))

describe('AlignmentGuides', () => {
  it('renders nothing when no guides', () => {
    const { container } = render(<AlignmentGuides guides={[]} />)
    expect(container.querySelector('svg')).toBeNull()
  })

  it('projects an x-axis guide through the viewport transform', () => {
    const guides: Guide[] = [{ axis: 'x', position: 100, start: 0, end: 200 }]
    const { container } = render(<AlignmentGuides guides={guides} />)
    const line = container.querySelector('line')!
    // x = position * zoom + vx → 100*2 + 50 = 250
    expect(line.getAttribute('x1')).toBe('250')
    expect(line.getAttribute('x2')).toBe('250')
    // y1 = start * zoom + vy → 0*2 + 100 = 100; y2 = 200*2 + 100 = 500
    expect(line.getAttribute('y1')).toBe('100')
    expect(line.getAttribute('y2')).toBe('500')
  })

  it('projects a y-axis guide horizontally', () => {
    const guides: Guide[] = [{ axis: 'y', position: 50, start: 10, end: 60 }]
    const { container } = render(<AlignmentGuides guides={guides} />)
    const line = container.querySelector('line')!
    // y = 50*2 + 100 = 200; x1 = 10*2 + 50 = 70; x2 = 60*2 + 50 = 170
    expect(line.getAttribute('y1')).toBe('200')
    expect(line.getAttribute('y2')).toBe('200')
    expect(line.getAttribute('x1')).toBe('70')
    expect(line.getAttribute('x2')).toBe('170')
  })

  it('renders one line per guide', () => {
    const guides: Guide[] = [
      { axis: 'x', position: 100, start: 0, end: 200 },
      { axis: 'y', position: 50, start: 10, end: 60 },
    ]
    const { container } = render(<AlignmentGuides guides={guides} />)
    expect(container.querySelectorAll('line')).toHaveLength(2)
  })
})

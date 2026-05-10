import { describe, it, expect } from 'vitest'
import { computeSnap, unionBox, type Box } from '../alignment'

const box = (id: string, x: number, y: number, width = 100, height = 50): Box => ({ id, x, y, width, height })

describe('computeSnap', () => {
  it('returns zero deltas with no candidates', () => {
    const r = computeSnap(box('a', 0, 0), [], 6)
    expect(r).toEqual({ deltaX: 0, deltaY: 0, guides: [] })
  })

  it('snaps left edges when within threshold (same-size boxes show all aligned guides)', () => {
    const dragged = box('a', 102, 200) // left=102
    const other = box('b', 100, 0)     // left=100 → delta -2 → all three edges tie
    const r = computeSnap(dragged, [other], 6)
    expect(r.deltaX).toBe(-2)
    expect(r.deltaY).toBe(0)
    // Same width: left/center/right all tie at delta -2. Draw all three guides.
    expect(r.guides.map((g) => g.position).sort((a, b) => a - b)).toEqual([100, 150, 200])
    expect(r.guides.every((g) => g.axis === 'x')).toBe(true)
  })

  it('shows a single guide when only one edge aligns', () => {
    const dragged = box('a', 102, 200, 80, 50)  // left=102, center=142, right=182
    const other = box('b', 100, 0, 100, 50)      // left=100, center=150, right=200
    const r = computeSnap(dragged, [other], 6)
    expect(r.deltaX).toBe(-2) // left↔left wins
    expect(r.guides).toHaveLength(1)
    expect(r.guides[0].position).toBe(100)
  })

  it('does not snap when outside threshold', () => {
    const dragged = box('a', 110, 200)
    const other = box('b', 100, 0)
    const r = computeSnap(dragged, [other], 6)
    expect(r.deltaX).toBe(0)
    expect(r.guides).toHaveLength(0)
  })

  it('snaps centerX to centerX', () => {
    const dragged = box('a', 51, 300, 100, 50)   // center=101
    const other = box('b', 75, 0, 50, 50)        // center=100 → delta -1
    const r = computeSnap(dragged, [other], 6)
    expect(r.deltaX).toBe(-1)
    expect(r.guides).toHaveLength(1)
    expect(r.guides[0].position).toBe(100)
  })

  it('snaps right edge of dragged to left edge of candidate', () => {
    const dragged = box('a', 0, 200)   // right=100
    const other = box('b', 102, 0)     // left=102 → delta +2
    const r = computeSnap(dragged, [other], 6)
    expect(r.deltaX).toBe(2)
  })

  it('snaps both axes simultaneously', () => {
    const dragged = box('a', 102, 53, 80, 30)
    const other = box('b', 100, 50, 100, 50)
    const r = computeSnap(dragged, [other], 6)
    expect(r.deltaX).toBe(-2)
    expect(r.deltaY).toBe(-3)
    // Distinct sizes → exactly one X guide and one Y guide.
    expect(r.guides.filter((g) => g.axis === 'x')).toHaveLength(1)
    expect(r.guides.filter((g) => g.axis === 'y')).toHaveLength(1)
  })

  it('picks the closest match when multiple candidates compete', () => {
    const dragged = box('a', 103, 0)
    const closer = box('b', 100, 0)    // delta -3
    const farther = box('c', 109, 0)   // delta +6 — also within threshold but worse
    const r = computeSnap(dragged, [closer, farther], 6)
    expect(r.deltaX).toBe(-3)
  })

  it('ignores the dragged box itself when present in candidates', () => {
    const dragged = box('a', 102, 0)
    const r = computeSnap(dragged, [dragged, box('b', 100, 0)], 6)
    expect(r.deltaX).toBe(-2)
  })

  it('returns no snap with non-positive threshold', () => {
    const r = computeSnap(box('a', 100, 0), [box('b', 100, 0)], 0)
    expect(r.guides).toEqual([])
  })

  it('guide span covers both involved boxes', () => {
    const dragged = box('a', 102, 200, 100, 50) // y range 200..250
    const other = box('b', 100, 0, 100, 50)     // y range 0..50
    const r = computeSnap(dragged, [other], 6)
    const g = r.guides[0]
    expect(g.start).toBeLessThanOrEqual(0)
    expect(g.end).toBeGreaterThanOrEqual(250)
  })
})

describe('unionBox', () => {
  it('returns null for empty input', () => {
    expect(unionBox([])).toBeNull()
  })

  it('returns the box itself for one input', () => {
    const b = box('a', 10, 20, 30, 40)
    expect(unionBox([b])).toMatchObject({ x: 10, y: 20, width: 30, height: 40 })
  })

  it('computes union of multiple boxes', () => {
    const u = unionBox([box('a', 0, 0, 50, 50), box('b', 100, 100, 50, 50)])
    expect(u).toMatchObject({ x: 0, y: 0, width: 150, height: 150 })
  })
})

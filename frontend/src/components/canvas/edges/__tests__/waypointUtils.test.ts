import { describe, it, expect } from 'vitest'
import { buildWaypointPath, distToSegment, findInsertIndex, snap45, snap45both } from '../waypointUtils'

describe('buildWaypointPath — bezier (default)', () => {
  it('builds a catmull-rom curve with no waypoints (start = end clamp)', () => {
    // With only 2 pts (src + target), catmull-rom = cubic bezier
    const path = buildWaypointPath(0, 0, [], 100, 100)
    expect(path).toMatch(/^M 0 0 C/)
  })

  it('routes through a single waypoint with smooth curve', () => {
    const path = buildWaypointPath(0, 0, [{ x: 50, y: 0 }], 100, 100)
    expect(path).toMatch(/^M 0 0 C/)
    // Should not be a straight polyline
    expect(path).not.toContain(' L ')
  })

  it('routes through multiple waypoints', () => {
    const path = buildWaypointPath(0, 0, [{ x: 50, y: 0 }, { x: 50, y: 100 }], 100, 100)
    expect(path).toMatch(/^M 0 0 C/)
  })
})

describe('buildWaypointPath — smooth style', () => {
  it('builds a direct straight line with no waypoints (no bend)', () => {
    // Only 2 points → no intermediate vertex → no rounding needed
    expect(buildWaypointPath(0, 0, [], 100, 100, 'smooth')).toBe('M 0 0 L 100 100')
  })

  it('routes through a single waypoint with straight lines (no intermediate bend)', () => {
    // 3 pts: src → wp → target — only 1 intermediate → rounded corners at wp
    const path = buildWaypointPath(0, 0, [{ x: 50, y: 0 }], 100, 100, 'smooth')
    // Should start at source and end at target
    expect(path).toMatch(/^M 0 0/)
    expect(path).toMatch(/100 100$/)
    // Should contain a quadratic bezier at the waypoint corner
    expect(path).toContain('Q')
  })

  it('routes through multiple waypoints with rounded corners', () => {
    const path = buildWaypointPath(0, 0, [{ x: 50, y: 0 }, { x: 50, y: 100 }], 100, 100, 'smooth')
    expect(path).toMatch(/^M 0 0/)
    expect(path).toMatch(/100 100$/)
    expect(path).toContain('Q')
  })

  it('does not round corners when segment is too short (r clamped to 0)', () => {
    // Adjacent waypoints very close together — r → 0, falls back to L
    const path = buildWaypointPath(0, 0, [{ x: 1, y: 0 }, { x: 2, y: 0 }], 100, 0, 'smooth')
    expect(path).toMatch(/^M 0 0/)
  })
})

describe('snap45', () => {
  // Use positions very close to a 45° angle so deviation < SNAP_THRESHOLD (15px)
  it('snaps horizontal direction when close (deviation < threshold)', () => {
    // (100, 3) — nearly horizontal, deviation from 0° ≈ 3px → snaps
    const r = snap45({ x: 0, y: 0 }, { x: 100, y: 3 })
    expect(r.y).toBe(0)
    expect(r.x).toBeGreaterThan(0)
  })

  it('snaps vertical direction when close', () => {
    const r = snap45({ x: 0, y: 0 }, { x: 3, y: 100 })
    expect(r.x).toBe(0)
    expect(r.y).toBeGreaterThan(0)
  })

  it('snaps 45° diagonal when close', () => {
    // (80, 83) — nearly 45°, deviation ≈ 2px → snaps
    const r = snap45({ x: 0, y: 0 }, { x: 80, y: 83 })
    expect(r.x).toBe(r.y)
  })

  it('does NOT snap when deviation exceeds threshold', () => {
    // (100, 40) — deviation from 0° is ~40px > 15 → no snap
    const pos = { x: 100, y: 40 }
    const r = snap45({ x: 0, y: 0 }, pos)
    expect(r).toEqual(pos)
  })

  it('returns pos unchanged when distance < 1', () => {
    const pos = { x: 5, y: 5 }
    expect(snap45({ x: 5, y: 5 }, pos)).toBe(pos)
  })

  it('preserves distance from origin when snapping', () => {
    const from = { x: 0, y: 0 }
    const pos = { x: 100, y: 3 }  // close to horizontal
    const r = snap45(from, pos)
    const origDist = Math.hypot(pos.x - from.x, pos.y - from.y)
    const snapDist = Math.hypot(r.x - from.x, r.y - from.y)
    expect(snapDist).toBeCloseTo(origDist, 0)
  })
})

describe('snap45both', () => {
  it('finds intersection satisfying 45° from both adjacent points (axis-aligned)', () => {
    // prev=(0,0), next=(100,100): diagonal — midpoint (50,50) should satisfy both
    const r = snap45both({ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 50, y: 50 })
    // Result must be on a 45°-ray from (0,0)
    const a1 = Math.atan2(r.y - 0, r.x - 0) / (Math.PI / 4)
    expect(Math.abs(a1 - Math.round(a1))).toBeLessThan(0.05)
    // Result must be on a 45°-ray from (100,100)
    const a2 = Math.atan2(r.y - 100, r.x - 100) / (Math.PI / 4)
    expect(Math.abs(a2 - Math.round(a2))).toBeLessThan(0.05)
  })

  it('snaps so both incoming and outgoing segments are at 45° when within threshold', () => {
    // prev=(0,0), next=(200,0) — valid intersection at (100,100) (45° from each)
    // pos=(100,93) is 7px away → within 15px threshold → should snap to (100,100)
    const r = snap45both({ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 100, y: 93 })
    const a1 = Math.atan2(r.y - 0, r.x - 0) / (Math.PI / 4)
    expect(Math.abs(a1 - Math.round(a1))).toBeLessThan(0.05)
    const a2 = Math.atan2(r.y - 0, r.x - 200) / (Math.PI / 4)
    expect(Math.abs(a2 - Math.round(a2))).toBeLessThan(0.05)
  })

  it('returns raw pos when beyond threshold', () => {
    // pos=(100,80) is 20px from nearest intersection (100,100) → no snap
    const pos = { x: 100, y: 80 }
    const r = snap45both({ x: 0, y: 0 }, { x: 200, y: 0 }, pos)
    expect(r).toEqual(pos)
  })

  it('falls back gracefully when prev === next', () => {
    // No valid intersection → fallback to snap45
    const r = snap45both({ x: 50, y: 50 }, { x: 50, y: 50 }, { x: 100, y: 90 })
    expect(r).toBeDefined()
  })
})

describe('distToSegment', () => {
  it('returns 0 when point is on the segment', () => {
    expect(distToSegment({ x: 50, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 0 })).toBeCloseTo(0)
  })

  it('returns perpendicular distance when point is beside segment', () => {
    expect(distToSegment({ x: 50, y: 10 }, { x: 0, y: 0 }, { x: 100, y: 0 })).toBeCloseTo(10)
  })

  it('returns distance to nearest endpoint when point is past the segment', () => {
    expect(distToSegment({ x: 200, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 0 })).toBeCloseTo(100)
  })

  it('handles zero-length segment (a === b)', () => {
    expect(distToSegment({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBeCloseTo(5)
  })
})

describe('findInsertIndex', () => {
  it('returns 0 when there are no waypoints (only one segment)', () => {
    expect(findInsertIndex(0, 0, [], 100, 0, { x: 50, y: 5 })).toBe(0)
  })

  it('inserts before first waypoint when click is on first segment', () => {
    const idx = findInsertIndex(0, 0, [{ x: 100, y: 0 }], 200, 0, { x: 30, y: 5 })
    expect(idx).toBe(0)
  })

  it('inserts after first waypoint when click is on second segment', () => {
    const idx = findInsertIndex(0, 0, [{ x: 100, y: 0 }], 200, 0, { x: 160, y: 5 })
    expect(idx).toBe(1)
  })

  it('picks the closest segment among multiple', () => {
    const idx = findInsertIndex(
      0, 0,
      [{ x: 100, y: 0 }, { x: 100, y: 100 }],
      200, 100,
      { x: 150, y: 105 },
    )
    expect(idx).toBe(2)
  })
})

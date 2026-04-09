import type { Waypoint } from '@/types'

// ── Path builders ─────────────────────────────────────────────────────────────

/** Catmull-Rom → cubic bezier for smooth curves through waypoints */
function buildCatmullRomPath(pts: Waypoint[]): string {
  if (pts.length < 2) return `M ${pts[0].x} ${pts[0].y}`
  let d = `M ${pts[0].x} ${pts[0].y}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(i - 1, 0)]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[Math.min(i + 2, pts.length - 1)]
    const cp1x = p1.x + (p2.x - p0.x) / 6
    const cp1y = p1.y + (p2.y - p0.y) / 6
    const cp2x = p2.x - (p3.x - p1.x) / 6
    const cp2y = p2.y - (p3.y - p1.y) / 6
    d += ` C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${p2.x} ${p2.y}`
  }
  return d
}

/** Polyline with rounded corners at each waypoint vertex (quadratic bezier) */
function buildRoundedPolylinePath(pts: Waypoint[], radius = 8): string {
  if (pts.length < 2) return `M ${pts[0].x} ${pts[0].y}`
  if (pts.length === 2) return `M ${pts[0].x} ${pts[0].y} L ${pts[1].x} ${pts[1].y}`

  let d = `M ${pts[0].x} ${pts[0].y}`

  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1]
    const curr = pts[i]
    const next = pts[i + 1]

    const dx1 = curr.x - prev.x
    const dy1 = curr.y - prev.y
    const len1 = Math.hypot(dx1, dy1)

    const dx2 = next.x - curr.x
    const dy2 = next.y - curr.y
    const len2 = Math.hypot(dx2, dy2)

    if (len1 < 1 || len2 < 1) {
      d += ` L ${curr.x} ${curr.y}`
      continue
    }

    const r = Math.min(radius, len1 / 2, len2 / 2)

    // Approach point (on segment prev→curr, r units before corner)
    const bx = curr.x - (dx1 / len1) * r
    const by = curr.y - (dy1 / len1) * r

    // Departure point (on segment curr→next, r units after corner)
    const ax = curr.x + (dx2 / len2) * r
    const ay = curr.y + (dy2 / len2) * r

    d += ` L ${bx} ${by} Q ${curr.x} ${curr.y} ${ax} ${ay}`
  }

  d += ` L ${pts[pts.length - 1].x} ${pts[pts.length - 1].y}`
  return d
}

export function buildWaypointPath(
  sourceX: number, sourceY: number,
  waypoints: Waypoint[],
  targetX: number, targetY: number,
  pathStyle: string = 'bezier',
): string {
  const pts = [{ x: sourceX, y: sourceY }, ...waypoints, { x: targetX, y: targetY }]
  return pathStyle === 'smooth' ? buildRoundedPolylinePath(pts) : buildCatmullRomPath(pts)
}

// ── 45° snapping ──────────────────────────────────────────────────────────────

/**
 * Snap `pos` to the nearest 45°-multiple direction from `from`.
 * Only snaps when within SNAP_THRESHOLD px of a 45° position.
 */
export function snap45(from: Waypoint, pos: Waypoint): Waypoint {
  const dx = pos.x - from.x
  const dy = pos.y - from.y
  const dist = Math.hypot(dx, dy)
  if (dist < 1) return pos
  const angle = Math.atan2(dy, dx)
  const snapped = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4)
  const candidate = {
    x: Math.round(from.x + dist * Math.cos(snapped)),
    y: Math.round(from.y + dist * Math.sin(snapped)),
  }
  const deviation = Math.hypot(candidate.x - pos.x, candidate.y - pos.y)
  return deviation <= SNAP_THRESHOLD ? candidate : pos
}

/** Snap threshold in flow-space pixels. Only snap when this close to a 45° position. */
const SNAP_THRESHOLD = 15

/**
 * Find the position closest to `pos` that lies simultaneously on a 45°-ray
 * from `prev` AND on a 45°-ray from `next`.
 *
 * Only snaps when the nearest valid intersection is within SNAP_THRESHOLD px —
 * outside that zone the raw drag position is returned, allowing free placement.
 */
export function snap45both(prev: Waypoint, next: Waypoint, pos: Waypoint): Waypoint {
  let best: Waypoint | null = null
  let bestDist = Infinity

  for (let i = 0; i < 8; i++) {
    const a1 = i * Math.PI / 4
    const c1 = Math.cos(a1), s1 = Math.sin(a1)

    for (let j = 0; j < 8; j++) {
      const a2 = j * Math.PI / 4
      const c2 = Math.cos(a2), s2 = Math.sin(a2)

      const dx = next.x - prev.x
      const dy = next.y - prev.y
      const det = -c1 * s2 + c2 * s1
      if (Math.abs(det) < 1e-6) continue

      const t = (-dx * s2 + c2 * dy) / det
      const s = (c1 * dy - s1 * dx) / det
      if (t < -1e-6 || s < -1e-6) continue

      const ix = prev.x + t * c1
      const iy = prev.y + t * s1
      const d = Math.hypot(ix - pos.x, iy - pos.y)
      if (d < bestDist) {
        bestDist = d
        best = { x: Math.round(ix), y: Math.round(iy) }
      }
    }
  }

  // Only snap if close enough — otherwise let the waypoint move freely
  if (best === null || bestDist > SNAP_THRESHOLD) return pos
  return best
}

// ── Geometry helpers ──────────────────────────────────────────────────────────

export function distToSegment(p: Waypoint, a: Waypoint, b: Waypoint): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

export function findInsertIndex(
  sourceX: number, sourceY: number,
  waypoints: Waypoint[],
  targetX: number, targetY: number,
  point: Waypoint,
): number {
  const allPts = [{ x: sourceX, y: sourceY }, ...waypoints, { x: targetX, y: targetY }]
  let minDist = Infinity
  let best = 0
  for (let i = 0; i < allPts.length - 1; i++) {
    const d = distToSegment(point, allPts[i], allPts[i + 1])
    if (d < minDist) { minDist = d; best = i }
  }
  return best
}

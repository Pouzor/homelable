// Alignment-snap math for drag-time guides (draw.io / Figma style).
//
// Given a dragged box and a set of candidate boxes, return the snap delta
// (clamped by threshold, expressed in canvas px) plus the guide segments that
// should be drawn while the snap is engaged.
//
// All coordinates are absolute canvas coordinates — callers must resolve
// child-of-parent positions before calling.

export interface Box {
  id: string
  x: number
  y: number
  width: number
  height: number
}

export type GuideAxis = 'x' | 'y'

export interface Guide {
  axis: GuideAxis
  // Position along the perpendicular axis (x for vertical guide, y for horizontal).
  position: number
  // Span along the parallel axis: min/max of involved boxes' opposite-axis extents.
  start: number
  end: number
}

export interface SnapResult {
  deltaX: number
  deltaY: number
  guides: Guide[]
}

type EdgeKind = 'min' | 'center' | 'max'

interface AxisLine {
  kind: EdgeKind
  pos: number
  // Span of the source box along the perpendicular axis (used to extend guide segments).
  spanStart: number
  spanEnd: number
}

function xLines(box: Box): AxisLine[] {
  const top = box.y
  const bottom = box.y + box.height
  return [
    { kind: 'min', pos: box.x, spanStart: top, spanEnd: bottom },
    { kind: 'center', pos: box.x + box.width / 2, spanStart: top, spanEnd: bottom },
    { kind: 'max', pos: box.x + box.width, spanStart: top, spanEnd: bottom },
  ]
}

function yLines(box: Box): AxisLine[] {
  const left = box.x
  const right = box.x + box.width
  return [
    { kind: 'min', pos: box.y, spanStart: left, spanEnd: right },
    { kind: 'center', pos: box.y + box.height / 2, spanStart: left, spanEnd: right },
    { kind: 'max', pos: box.y + box.height, spanStart: left, spanEnd: right },
  ]
}

interface Match {
  delta: number
  guidePos: number
  candidate: AxisLine
  dragLine: AxisLine
}

// Find all (dragLine, candidateLine) pairs at the smallest |delta| within threshold.
// When boxes share dimensions, all three edges align simultaneously — return all.
function bestMatches(dragLines: AxisLine[], candidateLines: AxisLine[], threshold: number): Match[] {
  let bestAbs = Infinity
  const matches: Match[] = []
  for (const d of dragLines) {
    for (const c of candidateLines) {
      const delta = c.pos - d.pos
      const abs = Math.abs(delta)
      if (abs > threshold) continue
      if (abs < bestAbs - 1e-9) {
        bestAbs = abs
        matches.length = 0
      }
      if (abs <= bestAbs + 1e-9) {
        matches.push({ delta, guidePos: c.pos, candidate: c, dragLine: d })
      }
    }
  }
  return matches
}

/**
 * Compute snap delta + visible guides for a drag operation.
 *
 * @param dragged   Bounding box of the dragged node (or selection bbox).
 * @param candidates Other nodes' boxes to consider.
 * @param threshold Max distance (canvas px) at which a snap engages.
 */
export function computeSnap(dragged: Box, candidates: Box[], threshold: number): SnapResult {
  if (candidates.length === 0 || threshold <= 0) {
    return { deltaX: 0, deltaY: 0, guides: [] }
  }

  const dragX = xLines(dragged)
  const dragY = yLines(dragged)

  let bestXMatches: Match[] = []
  let bestYMatches: Match[] = []
  let xBestAbs = Infinity
  let yBestAbs = Infinity

  for (const cand of candidates) {
    if (cand.id === dragged.id) continue
    const mx = bestMatches(dragX, xLines(cand), threshold)
    if (mx.length > 0) {
      const abs = Math.abs(mx[0].delta)
      if (abs < xBestAbs - 1e-9) {
        xBestAbs = abs
        bestXMatches = mx
      } else if (abs <= xBestAbs + 1e-9) {
        bestXMatches = bestXMatches.concat(mx)
      }
    }
    const my = bestMatches(dragY, yLines(cand), threshold)
    if (my.length > 0) {
      const abs = Math.abs(my[0].delta)
      if (abs < yBestAbs - 1e-9) {
        yBestAbs = abs
        bestYMatches = my
      } else if (abs <= yBestAbs + 1e-9) {
        bestYMatches = bestYMatches.concat(my)
      }
    }
  }

  const deltaX = bestXMatches[0]?.delta ?? 0
  const deltaY = bestYMatches[0]?.delta ?? 0

  const guides: Guide[] = []
  const seenX = new Set<number>()
  for (const m of bestXMatches) {
    if (seenX.has(m.guidePos)) continue
    seenX.add(m.guidePos)
    const start = Math.min(m.dragLine.spanStart + deltaY, m.candidate.spanStart)
    const end = Math.max(m.dragLine.spanEnd + deltaY, m.candidate.spanEnd)
    guides.push({ axis: 'x', position: m.guidePos, start, end })
  }
  const seenY = new Set<number>()
  for (const m of bestYMatches) {
    if (seenY.has(m.guidePos)) continue
    seenY.add(m.guidePos)
    const start = Math.min(m.dragLine.spanStart + deltaX, m.candidate.spanStart)
    const end = Math.max(m.dragLine.spanEnd + deltaX, m.candidate.spanEnd)
    guides.push({ axis: 'y', position: m.guidePos, start, end })
  }

  return { deltaX, deltaY, guides }
}

/** Bounding box of multiple boxes — used for multi-selection drag. */
export function unionBox(boxes: Box[]): Box | null {
  if (boxes.length === 0) return null
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const b of boxes) {
    if (b.x < minX) minX = b.x
    if (b.y < minY) minY = b.y
    if (b.x + b.width > maxX) maxX = b.x + b.width
    if (b.y + b.height > maxY) maxY = b.y + b.height
  }
  return { id: '__union__', x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

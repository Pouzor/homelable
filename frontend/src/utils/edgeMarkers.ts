import type { MarkerShape } from '@/types'

/** All selectable marker shapes, in picker order. */
export const MARKER_SHAPES: MarkerShape[] = [
  'none', 'arrow', 'arrow-open', 'circle', 'diamond', 'square',
]

const SHAPE_SET = new Set<string>(MARKER_SHAPES)

/**
 * Coerce any stored/legacy marker value into a MarkerShape.
 *  - legacy boolean `true`  → 'arrow'
 *  - legacy boolean `false` / null / undefined → 'none'
 *  - a valid shape string passes through
 *  - anything unknown → 'none'
 */
export function normalizeMarker(v: unknown): MarkerShape {
  if (v === true) return 'arrow'
  if (v === false || v == null) return 'none'
  if (typeof v === 'string' && SHAPE_SET.has(v)) return v as MarkerShape
  return 'none'
}

export type NonNoneMarkerShape = Exclude<MarkerShape, 'none'>

/**
 * SVG <marker> geometry per shape, drawn in a 0..10 viewBox.
 *  - `refX` positions the shape on the endpoint: directional shapes (arrow,
 *    arrow-open) put their tip on the point; symmetric caps (circle, diamond,
 *    square) centre on it.
 *  - `directional` shapes rotate with the edge; symmetric ones don't care.
 */
export const MARKER_GEOMETRY: Record<
  NonNoneMarkerShape,
  { refX: number; directional: boolean }
> = {
  arrow:        { refX: 9,   directional: true },
  'arrow-open': { refX: 8.5, directional: true },
  circle:       { refX: 5,   directional: false },
  diamond:      { refX: 5,   directional: false },
  square:       { refX: 5,   directional: false },
}

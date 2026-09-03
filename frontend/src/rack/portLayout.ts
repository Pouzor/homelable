/**
 * Where a port sits on its faceplate.
 *
 * Port coordinates are unit coordinates (0..1 on both axes), so the same numbers
 * describe the plate at any U height, rack width or zoom — see `faceplates.ts`.
 * Everything here is pure: the editor owns the pointer, this owns the maths.
 */
import type { Port } from '@/types'

/**
 * Keep a port off the very edge of the plate.
 *
 * The socket is drawn centred on its coordinate, so a port at x = 1 hangs half
 * outside the panel. The inset is roughly half a socket on a 1U plate.
 */
export const PORT_EDGE_INSET = 0.03

/** How close two ports must be, in pixels, before one snaps onto the other's axis. */
export const SNAP_PX = 6

export interface Point {
  x: number
  y: number
}

/**
 * Alignment guides to draw for a drag that snapped, in unit coordinates.
 * Null on an axis means the port is free there and no guide is shown.
 */
export interface SnapResult extends Point {
  guideX: number | null
  guideY: number | null
}

export function clampPort({ x, y }: Point): Point {
  const clamp = (v: number) => Math.min(1 - PORT_EDGE_INSET, Math.max(PORT_EDGE_INSET, v))
  return { x: clamp(x), y: clamp(y) }
}

/**
 * Snap distance on each axis, converted from pixels to unit coordinates.
 *
 * A plate is far wider than it is tall, so one shared unit threshold would snap
 * vertically at ten times the distance it snaps horizontally.
 */
export function snapThreshold(width: number, height: number, px: number = SNAP_PX): Point {
  return {
    x: width > 0 ? px / width : 0,
    y: height > 0 ? px / height : 0,
  }
}

/** Nearest value within `t`, or null when nothing is close enough. */
function nearest(value: number, values: number[], t: number): number | null {
  let best: number | null = null
  let bestDelta = t
  for (const candidate of values) {
    const delta = Math.abs(candidate - value)
    if (delta <= bestDelta) {
      best = candidate
      bestDelta = delta
    }
  }
  return best
}

/**
 * Pull a dragged port onto the nearest peer's row or column.
 *
 * Ports come in banks, and a bank only reads as one when its members share an
 * axis. Free dragging alone leaves a row of sockets a pixel out of line, which is
 * exactly the kind of thing nobody can fix by hand at this scale. Each axis snaps
 * on its own: a port can take its row from one peer and its column from another,
 * which is what makes a grid fall into place.
 */
export function snapToPeers(pos: Point, peers: Point[], threshold: Point): SnapResult {
  const { x, y } = clampPort(pos)
  const guideX = nearest(
    x,
    peers.map((p) => p.x),
    threshold.x,
  )
  const guideY = nearest(
    y,
    peers.map((p) => p.y),
    threshold.y,
  )
  return { x: guideX ?? x, y: guideY ?? y, guideX, guideY }
}

/** Horizontal step between two auto-placed ports, in unit coordinates. */
const NEXT_PORT_STEP = 0.06

/** Vertical drop when an auto-placed row runs into the right edge. */
const NEXT_ROW_STEP = 0.2

/**
 * Where a newly added port lands.
 *
 * Dropping every new port on the middle of the plate stacked them all on one
 * spot: the list said "3 ports" and the plate showed one. A new port continues
 * the last row instead, and wraps to a new one at the right edge.
 */
export function nextPortSpot(ports: Port[]): Point {
  const last = ports[ports.length - 1]
  if (!last) return { x: 0.5, y: 0.5 }
  const x = last.x + NEXT_PORT_STEP
  if (x <= 1 - PORT_EDGE_INSET) return { x, y: last.y }
  return clampPort({ x: PORT_EDGE_INSET, y: last.y + NEXT_ROW_STEP })
}

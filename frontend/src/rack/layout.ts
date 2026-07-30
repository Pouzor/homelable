/**
 * Rack geometry: U <-> pixel conversion, column math, occupancy and collision.
 *
 * All U values are 1-based and counted from the bottom rail, whatever the
 * rack's `numbering` setting is — numbering only affects the printed labels.
 */
import { RACK_COLUMNS, type Port, type Rack, type RackDevice } from './types'

/** Pixel height of one rack unit at zoom 1. */
export const U_PX = 24
/** Inner usable width, per rack standard. */
export const INNER_WIDTH_PX: Record<Rack['widthStandard'], number> = {
  '19': 456,
  '10': 264,
}
/** Rail strip width on each side of the usable area. */
export const RAIL_PX = 14
/** U-number gutter drawn outside the left rail. */
export const NUMBER_GUTTER_PX = 22
/** Chassis padding above and below the rails. */
export const FRAME_PAD_PX = 10
/** Name bar drawn inside the chassis, above the rails. */
export const HEADER_PX = 20
/** Y of the first U's top edge — kept inside the node so nothing gets clipped. */
export const INTERIOR_TOP_PX = FRAME_PAD_PX + HEADER_PX

export function innerWidth(rack: Rack): number {
  return INNER_WIDTH_PX[rack.widthStandard]
}

export function columnWidth(rack: Rack): number {
  return innerWidth(rack) / RACK_COLUMNS
}

/** Total node width of a rack, gutter + frame included. */
export function rackWidth(rack: Rack): number {
  const gutter = rack.style.showNumbers ? NUMBER_GUTTER_PX : 0
  return gutter + RAIL_PX * 2 + innerWidth(rack) + FRAME_PAD_PX * 2
}

/** Total node height of a rack. */
export function rackHeight(rack: Rack): number {
  return rack.uHeight * U_PX + INTERIOR_TOP_PX + FRAME_PAD_PX
}

/** X of the usable area's left edge, relative to the rack node. */
export function interiorLeft(rack: Rack): number {
  const gutter = rack.style.showNumbers ? NUMBER_GUTTER_PX : 0
  return gutter + FRAME_PAD_PX + RAIL_PX
}

/** Y of the top edge of a mount, relative to the rack node. */
export function uToY(rack: Rack, uStart: number, uHeight: number): number {
  const topU = uStart + uHeight - 1
  return INTERIOR_TOP_PX + (rack.uHeight - topU) * U_PX
}

/**
 * Which U a pointer sits on. `y` is relative to the rack node.
 * Clamped into [1, uHeight] so a drop slightly off the frame still lands.
 */
export function yToU(rack: Rack, y: number): number {
  const fromTop = Math.floor((y - INTERIOR_TOP_PX) / U_PX)
  const u = rack.uHeight - fromTop
  return clamp(u, 1, rack.uHeight)
}

/** Which column a pointer sits on. `x` is relative to the rack node. */
export function xToCol(rack: Rack, x: number): number {
  const col = Math.floor((x - interiorLeft(rack)) / columnWidth(rack))
  return clamp(col, 0, RACK_COLUMNS - 1)
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Printed label for a U, honouring the rack's numbering direction. */
export function uLabel(rack: Rack, u: number): number {
  return rack.numbering === 'bottom-up' ? u : rack.uHeight - u + 1
}

// ---------------------------------------------------------------------------
// Device / port geometry
// ---------------------------------------------------------------------------

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

/** Device box relative to the rack node. */
export function deviceBox(rack: Rack, device: RackDevice): Box {
  const col = columnWidth(rack)
  return {
    x: interiorLeft(rack) + device.colStart * col,
    y: uToY(rack, device.uStart, device.uHeight),
    width: device.colSpan * col,
    height: device.uHeight * U_PX,
  }
}

/** Port centre in canvas coordinates (rack position included). */
export function portPosition(
  rack: Rack,
  device: RackDevice,
  port: Port,
): { x: number; y: number } {
  const box = deviceBox(rack, device)
  return {
    x: rack.position.x + box.x + port.x * box.width,
    y: rack.position.y + box.y + port.y * box.height,
  }
}

// ---------------------------------------------------------------------------
// Occupancy
// ---------------------------------------------------------------------------

export interface Placement {
  uStart: number
  uHeight: number
  colStart: number
  colSpan: number
}

function overlaps(a: Placement, b: Placement): boolean {
  const uOverlap = a.uStart < b.uStart + b.uHeight && b.uStart < a.uStart + a.uHeight
  const colOverlap =
    a.colStart < b.colStart + b.colSpan && b.colStart < a.colStart + a.colSpan
  return uOverlap && colOverlap
}

/** True when the placement fits inside the rack bounds. */
export function isInBounds(rack: Rack, p: Placement): boolean {
  return (
    p.uStart >= 1 &&
    p.uHeight >= 1 &&
    p.uStart + p.uHeight - 1 <= rack.uHeight &&
    p.colStart >= 0 &&
    p.colSpan >= 1 &&
    p.colStart + p.colSpan <= RACK_COLUMNS
  )
}

/**
 * True when the placement fits and collides with nothing.
 * `ignoreId` skips the device being moved, so a no-op drag stays valid.
 */
export function canPlace(
  rack: Rack,
  devices: RackDevice[],
  p: Placement,
  ignoreId?: string,
): boolean {
  if (!isInBounds(rack, p)) return false
  return !devices.some(
    (d) => d.rackId === rack.id && d.id !== ignoreId && overlaps(p, d),
  )
}

/**
 * Nearest valid placement for a drop, searching the target U first and then
 * walking outwards. Returns null when the rack has no room at all.
 */
export function findSlot(
  rack: Rack,
  devices: RackDevice[],
  desired: Placement,
  ignoreId?: string,
): Placement | null {
  const maxU = rack.uHeight - desired.uHeight + 1
  if (maxU < 1) return null

  const colStart = clamp(desired.colStart, 0, RACK_COLUMNS - desired.colSpan)
  const targetU = clamp(desired.uStart, 1, maxU)

  for (let offset = 0; offset < rack.uHeight; offset++) {
    for (const u of offset === 0 ? [targetU] : [targetU - offset, targetU + offset]) {
      if (u < 1 || u > maxU) continue
      const candidate = { ...desired, uStart: u, colStart }
      if (canPlace(rack, devices, candidate, ignoreId)) return candidate
      // Same U may still have room on another column run.
      for (let c = 0; c <= RACK_COLUMNS - desired.colSpan; c++) {
        const shifted = { ...desired, uStart: u, colStart: c }
        if (canPlace(rack, devices, shifted, ignoreId)) return shifted
      }
    }
  }
  return null
}

/** Free U count, counting a U as free only when every column is free. */
export function freeUnits(rack: Rack, devices: RackDevice[]): number {
  let free = 0
  for (let u = 1; u <= rack.uHeight; u++) {
    const busy = devices.some(
      (d) => d.rackId === rack.id && u >= d.uStart && u < d.uStart + d.uHeight,
    )
    if (!busy) free++
  }
  return free
}

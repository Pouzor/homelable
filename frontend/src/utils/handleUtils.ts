/**
 * Per-side connection-point (React Flow Handle) configuration.
 *
 * Handle IDs:  slot 0        = the bare side name ('top' | 'bottom' | 'left' | 'right')
 *              slot N ≥ 1     = '${side}-${N + 1}'  (e.g. 'bottom-2', 'left-3', 'top-64')
 *
 * Slot 0 keeps the bare name so edges saved before the multi-handle expansion
 * (which reference 'top' / 'bottom') stay valid — full backward compatibility.
 *
 * Invisible target handles follow the same pattern with a '-t' suffix:
 *   'bottom-t', 'bottom-2-t', 'left-t', 'right-3-t', ...
 */

import type { NodeData } from '@/types'

export type Side = 'top' | 'bottom' | 'left' | 'right'

export const SIDES: readonly Side[] = ['top', 'bottom', 'left', 'right']

export const MAX_HANDLES = 64

/** Every side can go down to zero connection points. */
export const MIN_HANDLES = 0

// Back-compat aliases (bottom was the original, only, multi-handle side).
export const MIN_BOTTOM_HANDLES = MIN_HANDLES
export const MAX_BOTTOM_HANDLES = MAX_HANDLES

/**
 * Default count for a side when the node carries no explicit value.
 * Top/Bottom default to 1 (their historical single handle); Left/Right default
 * to 0 so existing diagrams gain no side handles unless the user opts in.
 * This is a default, not a minimum — see MIN_HANDLES.
 */
export function sideDefault(side: Side): number {
  return side === 'top' || side === 'bottom' ? 1 : 0
}

/** The NodeData field name that stores a side's handle count. */
export function handleCountField(side: Side): 'top_handles' | 'bottom_handles' | 'left_handles' | 'right_handles' {
  return `${side}_handles` as 'top_handles' | 'bottom_handles' | 'left_handles' | 'right_handles'
}

/** Resolved connection-point count for a side (missing field → side default). */
export function sideHandleCount(data: NodeData, side: Side): number {
  return clampHandles(side, data[handleCountField(side)] ?? sideDefault(side))
}

/** Returns the source handle ID at a given slot index for a side. */
export function handleId(side: Side, idx: number): string {
  return idx === 0 ? side : `${side}-${idx + 1}`
}

/**
 * Clamp a raw count into the supported range (0..64) for a side.
 * A non-numeric / non-finite input falls back to the side default, so a missing
 * or corrupt field still yields the historical count; an explicit 0 is honoured.
 */
export function clampHandles(side: Side, n: unknown): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return sideDefault(side)
  const i = Math.floor(n)
  if (i < MIN_HANDLES) return MIN_HANDLES
  if (i > MAX_HANDLES) return MAX_HANDLES
  return i
}

/**
 * Percentage offsets for each handle slot along the side's axis.
 * Horizontal sides (top/bottom) → left %, vertical sides (left/right) → top %.
 * Counts 1..4 keep the original hand-tuned values to preserve exact pixel
 * positions on canvases saved before the multi-handle expansion.
 * Counts ≥ 5 use uniform spacing. Count 0 → [].
 */
export function handlePositions(side: Side, count: number): number[] {
  const c = clampHandles(side, count)
  switch (c) {
    case 0: return []
    case 1: return [50]
    case 2: return [25, 75]
    case 3: return [20, 50, 80]
    case 4: return [15, 38, 62, 85]
    default: return Array.from({ length: c }, (_, i) => ((i + 1) * 100) / (c + 1))
  }
}

/** True when a side lays out its handles vertically (offset is a top %). */
export function isVerticalSide(side: Side): boolean {
  return side === 'left' || side === 'right'
}

/**
 * Normalize a raw handle ID coming from a React Flow connection event.
 * Invisible target handles (e.g. 'bottom-2-t', 'left-t') are mapped to their
 * source counterpart ('bottom-2', 'left') so the stored edge ID is stable.
 */
export function normalizeHandle(h: string | null | undefined): string | null {
  if (!h) return null
  const m = h.match(/^((?:top|bottom|left|right)(?:-\d+)?)-t$/)
  if (m) return m[1]
  return h
}

/**
 * Returns the set of source handle IDs removed when a side's count is reduced
 * from `oldCount` to `newCount`.
 */
export function removedHandleIds(side: Side, oldCount: number, newCount: number): Set<string> {
  const removed = new Set<string>()
  for (let i = newCount; i < oldCount; i++) {
    removed.add(handleId(side, i))
  }
  return removed
}

// ---------------------------------------------------------------------------
// Deprecated bottom-only aliases — kept so existing call sites don't churn.
// Prefer the side-generic functions above.
// ---------------------------------------------------------------------------

/** @deprecated use handleId('bottom', idx) */
export function bottomHandleId(idx: number): string {
  return handleId('bottom', idx)
}

/** @deprecated use clampHandles('bottom', n) */
export function clampBottomHandles(n: unknown): number {
  return clampHandles('bottom', n)
}

/** @deprecated use handlePositions('bottom', count) */
export function bottomHandlePositions(count: number): number[] {
  return handlePositions('bottom', count)
}

/** @deprecated use removedHandleIds('bottom', oldCount, newCount) */
export function removedBottomHandleIds(oldCount: number, newCount: number): Set<string> {
  return removedHandleIds('bottom', oldCount, newCount)
}

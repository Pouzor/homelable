/**
 * Bottom handle configuration for multi-handle nodes.
 *
 * Handle IDs:  index 0 = 'bottom' (always the default, backward-compatible)
 *              index N≥1 = 'bottom-${N+1}'  (so idx 1 = 'bottom-2', idx 47 = 'bottom-48')
 *
 * Invisible target handles follow the same pattern with a '-t' suffix:
 *   'bottom-t', 'bottom-2-t', ..., 'bottom-48-t'
 */

export const MIN_BOTTOM_HANDLES = 1
export const MAX_BOTTOM_HANDLES = 48

/** Returns the source handle ID at a given slot index. */
export function bottomHandleId(idx: number): string {
  return idx === 0 ? 'bottom' : `bottom-${idx + 1}`
}

/** Clamp a raw count into the supported range. Non-finite or non-int → MIN. */
export function clampBottomHandles(n: unknown): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return MIN_BOTTOM_HANDLES
  const i = Math.floor(n)
  if (i < MIN_BOTTOM_HANDLES) return MIN_BOTTOM_HANDLES
  if (i > MAX_BOTTOM_HANDLES) return MAX_BOTTOM_HANDLES
  return i
}

/**
 * Left % positions for each handle slot.
 * Counts 1..4 keep their original hand-tuned values to preserve exact pixel
 * positions on canvases saved before the multi-handle expansion.
 * Counts ≥ 5 use uniform spacing.
 */
export function bottomHandlePositions(count: number): number[] {
  const c = clampBottomHandles(count)
  switch (c) {
    case 1: return [50]
    case 2: return [25, 75]
    case 3: return [20, 50, 80]
    case 4: return [15, 38, 62, 85]
    default: return Array.from({ length: c }, (_, i) => ((i + 1) * 100) / (c + 1))
  }
}

/**
 * Normalize a raw handle ID coming from a React Flow connection event.
 * Invisible target handles (e.g. 'bottom-2-t') are mapped to their source
 * counterpart ('bottom-2') so the stored edge ID is stable and consistent.
 */
export function normalizeHandle(h: string | null | undefined): string | null {
  if (!h) return null
  if (h === 'top-t') return 'top'
  // 'bottom-t' → 'bottom', 'bottom-2-t' → 'bottom-2', etc.
  const m = h.match(/^(bottom(?:-\d+)?)-t$/)
  if (m) return m[1]
  return h
}

/**
 * Returns the set of handle IDs that are removed when bottom_handles
 * is reduced from `oldCount` to `newCount`.
 */
export function removedBottomHandleIds(oldCount: number, newCount: number): Set<string> {
  const removed = new Set<string>()
  for (let i = newCount; i < oldCount; i++) {
    removed.add(bottomHandleId(i))
  }
  return removed
}

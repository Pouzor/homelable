/**
 * Bottom handle helpers for multi-handle nodes.
 *
 * Handle IDs: index 0 = 'bottom' (always backward-compatible), then
 *             'bottom-2', 'bottom-3', ... for additional handles.
 */

export function bottomHandleIdAt(index: number): string {
  return index === 0 ? 'bottom' : `bottom-${index + 1}`
}

/** Build the ordered handle ids for a node with `count` bottom handles. */
export function getBottomHandleIds(count: number): string[] {
  const safeCount = Math.max(1, Math.floor(count))
  return Array.from({ length: safeCount }, (_, i) => bottomHandleIdAt(i))
}

/**
 * Left % position for each handle slot, per count.
 * For up to 4 handles, preserve the existing spacing; above that, distribute
 * evenly with side padding so end handles don't sit on rounded corners.
 */
export function getBottomHandlePositions(count: number): number[] {
  const safeCount = Math.max(1, Math.floor(count))
  if (safeCount === 1) return [50]
  if (safeCount === 2) return [25, 75]
  if (safeCount === 3) return [20, 50, 80]
  if (safeCount === 4) return [15, 38, 62, 85]

  const edgePaddingPct = 8
  const span = 100 - edgePaddingPct * 2
  const step = span / (safeCount - 1)
  return Array.from({ length: safeCount }, (_, i) => Number((edgePaddingPct + step * i).toFixed(2)))
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
  const safeOld = Math.max(1, Math.floor(oldCount))
  const safeNew = Math.max(1, Math.floor(newCount))
  for (let i = safeNew; i < safeOld; i++) {
    removed.add(bottomHandleIdAt(i))
  }
  return removed
}

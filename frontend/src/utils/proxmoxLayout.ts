/**
 * Shared layout constants and helpers for Proxmox container-mode node grids.
 *
 * Used by both the import handler (App.tsx) and the store reflow action
 * (canvasStore.ts) so the two code paths stay in sync.
 */

/** Horizontal space allocated per child column (px, relative to parent). */
export const CHILD_SLOT_W = 160
/** Vertical space allocated per child row (px). */
export const CHILD_SLOT_H = 68
/** Horizontal gap between columns (px). */
export const COL_GAP = 8
/** Vertical gap between rows (px). */
export const ROW_GAP = 4
/** Container inner padding on all sides (px). */
export const CONTAINER_PADDING = 10
/** Height of the container's header bar (px). */
export const CONTAINER_HEADER_H = 52

/**
 * Compute container width and height to exactly fit `childCount` children
 * arranged in `cols` columns.
 */
export function containerDims(childCount: number, cols: number): { width: number; height: number } {
  const safeCols = Math.max(1, Math.min(cols, Math.max(1, childCount)))
  const rows = Math.ceil(childCount / safeCols)
  const width = Math.max(
    220,
    CONTAINER_PADDING * 2 + safeCols * CHILD_SLOT_W + (safeCols - 1) * COL_GAP,
  )
  const height = Math.max(
    200,
    CONTAINER_HEADER_H + CONTAINER_PADDING + rows * CHILD_SLOT_H + (rows - 1) * ROW_GAP + CONTAINER_PADDING,
  )
  return { width, height }
}

/**
 * Return the **parent-relative** position for the i-th child in a grid with
 * `cols` columns.
 */
export function childRelPos(i: number, cols: number): { x: number; y: number } {
  const safeCols = Math.max(1, cols)
  const col = i % safeCols
  const row = Math.floor(i / safeCols)
  return {
    x: CONTAINER_PADDING + col * (CHILD_SLOT_W + COL_GAP),
    y: CONTAINER_HEADER_H + CONTAINER_PADDING + row * (CHILD_SLOT_H + ROW_GAP),
  }
}

/**
 * Drag payload shared between the inventory tray and the rack drop targets.
 *
 * `dataTransfer.getData()` is blocked during `dragover` in every browser, and
 * the drop preview needs the payload on every move — so the payload also lives
 * in a module-level slot for the duration of the drag.
 */
export type DragPayload =
  | { kind: 'inventory'; id: string; faceplateId: string }
  | { kind: 'accessory'; id: string; faceplateId: string }
  | { kind: 'device'; id: string }

export const DRAG_MIME = 'application/homelable-rack'

let current: DragPayload | null = null

export function startDrag(dataTransfer: DataTransfer, payload: DragPayload): void {
  current = payload
  dataTransfer.setData(DRAG_MIME, JSON.stringify(payload))
  dataTransfer.effectAllowed = 'move'
}

export function getDragPayload(): DragPayload | null {
  return current
}

export function endDrag(): void {
  current = null
}

/** Falls back to the module slot when the browser withholds the data. */
export function parseDragPayload(dataTransfer: DataTransfer | null): DragPayload | null {
  const raw = dataTransfer?.getData(DRAG_MIME)
  if (!raw) return current
  try {
    return JSON.parse(raw) as DragPayload
  } catch {
    return current
  }
}

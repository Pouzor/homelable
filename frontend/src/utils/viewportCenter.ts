import type { XYPosition } from '@xyflow/react'

// Projects the centre of the visible canvas into flow-space coordinates.
// Registered by CanvasContainer (inside ReactFlowProvider) so that add-node
// handlers living outside the provider — App handlers, modals — can still drop
// new nodes where the user is actually looking instead of at a fixed canvas
// origin.
type Projector = () => XYPosition

let projector: Projector | null = null

// Used before any canvas is mounted (tests, first render). Matches the old
// hard-coded add position so behaviour degrades gracefully.
const FALLBACK: XYPosition = { x: 300, y: 300 }

export function setViewportCenterProjector(fn: Projector | null): void {
  projector = fn
}

// Flow-space coordinate at the centre of the visible canvas.
export function getViewportCenter(): XYPosition {
  return projector ? projector() : { ...FALLBACK }
}

// Flow-space top-left position so that a box of `width`×`height` ends up
// centred on screen. With no size it returns the raw centre point.
export function getCenteredPosition(width = 0, height = 0): XYPosition {
  const c = getViewportCenter()
  return { x: c.x - width / 2, y: c.y - height / 2 }
}

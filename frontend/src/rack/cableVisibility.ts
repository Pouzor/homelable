/**
 * Which cables the canvas is currently drawing.
 *
 * Two components need the same answer and must not drift: `CableLayer` draws
 * the runs, and `RackFlowNode` reveals the sockets they end on — a cable that
 * lands on a plate with no port drawn reads as a rendering bug.
 */
import type { Cable, CableVisibility } from '@/types/rack'

export interface CableFocus {
  visibility: CableVisibility
  /** Patch mode shows everything, whatever the visibility setting. */
  cableMode: boolean
  /** Hovered device, else the selected one. */
  focusDeviceId: string | null
  /** The cable whose panel is open on the right. */
  selectedCableId: string | null
}

/** Cables drawn right now, in input order. */
export function visibleCables(cables: Cable[], focus: CableFocus): Cable[] {
  const showAll = focus.cableMode || focus.visibility === 'always'
  return cables.filter((cable) => {
    // A selected cable stays on screen whatever the visibility mode — its panel
    // is open on the right, so hiding the run it describes reads as a bug.
    if (showAll || cable.id === focus.selectedCableId) return true
    // `hidden` means hidden: hovering a plate reveals nothing extra, or the
    // selection would drag its neighbours back on screen with it.
    if (focus.visibility === 'hidden') return false
    if (!focus.focusDeviceId) return false
    return cable.from.deviceId === focus.focusDeviceId || cable.to.deviceId === focus.focusDeviceId
  })
}

/** Every port a drawn cable ends on. Those sockets must be rendered. */
export function patchedPortIds(cables: Cable[], focus: CableFocus): Set<string> {
  const ids = new Set<string>()
  for (const cable of visibleCables(cables, focus)) {
    ids.add(cable.from.portId)
    ids.add(cable.to.portId)
  }
  return ids
}

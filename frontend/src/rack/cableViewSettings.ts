/**
 * How the rack canvas shows its cabling — the visibility mode and the label
 * toggle — remembered across reloads and design switches.
 *
 * A per-viewer UI preference, not rack data: it lives in localStorage, never in
 * the saved rack state, and a save never carries it. Patch mode forcing every
 * cable on is not a preference and is never written here.
 */
import type { CableVisibility } from '@/types/rack'

export interface CableViewSettings {
  visibility: CableVisibility
  labelsVisible: boolean
}

export const DEFAULT_CABLE_VIEW_SETTINGS: CableViewSettings = {
  visibility: 'hover',
  labelsVisible: true,
}

const KEY = 'homelable.rackCableView'
const VISIBILITIES: readonly CableVisibility[] = ['hover', 'always', 'hidden']

export function readCableViewSettings(): CableViewSettings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULT_CABLE_VIEW_SETTINGS
    const parsed = JSON.parse(raw) as Partial<Record<keyof CableViewSettings, unknown>>
    return {
      visibility: VISIBILITIES.includes(parsed.visibility as CableVisibility)
        ? (parsed.visibility as CableVisibility)
        : DEFAULT_CABLE_VIEW_SETTINGS.visibility,
      labelsVisible:
        typeof parsed.labelsVisible === 'boolean'
          ? parsed.labelsVisible
          : DEFAULT_CABLE_VIEW_SETTINGS.labelsVisible,
    }
  } catch {
    return DEFAULT_CABLE_VIEW_SETTINGS
  }
}

/** Merges `patch` into what is stored, so each setter only names its own key. */
export function writeCableViewSettings(patch: Partial<CableViewSettings>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...readCableViewSettings(), ...patch }))
  } catch {
    /* private window, quota, blocked storage — the setting just won't stick */
  }
}

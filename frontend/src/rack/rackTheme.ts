/**
 * Rack palette, derived from the active app theme.
 *
 * Deliberately derived rather than declared per theme: the rack canvas needs a
 * background, a text colour, an accent and the status dots — all of which the
 * node/edge themes already define. Deriving keeps a new theme working with the
 * rack view for free, and keeps the two from drifting apart.
 *
 * Rack chrome proper (frame, rails, interior) stays user-configurable per rack;
 * only its *default* comes from here.
 */
import { useThemeStore } from '@/stores/themeStore'
import { THEMES } from '@/utils/themes'
import type { ThemeId } from '@/utils/themes'
import type { DeviceStatus, RackStyle } from '@/types'

export interface RackPalette {
  /** Canvas background and dot grid. */
  canvas: string
  dot: string
  /** Faceplate default fill and its outline. */
  plate: string
  plateOutline: string
  /** Primary and secondary text on the rack (labels, U numbers). */
  text: string
  muted: string
  /** Selection accent, shared with the rest of the app. */
  accent: string
  /** Status LED on a mounted device. */
  status: Record<DeviceStatus, string>
  /** Port artwork: dark recess, metal bezel. */
  portRecess: string
  portBezel: string
  /** Default chrome for a newly created rack. */
  defaultRackStyle: RackStyle
}

export function rackPalette(themeId: ThemeId): RackPalette {
  const c = THEMES[themeId]?.colors ?? THEMES.default.colors
  const light = c.reactFlowColorMode === 'light'

  return {
    canvas: c.canvasBackground,
    dot: c.canvasDotColor,
    plate: c.nodeCardBackground,
    plateOutline: c.canvasBackground,
    text: c.nodeLabelColor,
    muted: c.nodeSubtextColor,
    accent: c.nodeAccents.router.border,
    status: {
      online: c.statusColors.online,
      offline: c.statusColors.offline,
      unknown: c.statusColors.unknown,
    },
    // A jack is a hole: darker than the plate on dark themes, and still darker
    // (not lighter) on light ones, or the artwork stops reading as a socket.
    portRecess: light ? '#c9d1d9' : '#0b0e13',
    portBezel: c.nodeSubtextColor,
    defaultRackStyle: {
      frame: c.nodeIconBackground,
      rail: c.nodeSubtextColor,
      interior: c.canvasBackground,
      showNumbers: true,
      enclosed: false,
    },
  }
}

/** Palette for the active theme. Re-renders with a theme switch. */
export function useRackPalette(): RackPalette {
  const activeTheme = useThemeStore((s) => s.activeTheme)
  return rackPalette(activeTheme)
}

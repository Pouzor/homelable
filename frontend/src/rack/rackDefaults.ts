/** Shared defaults, kept out of the store to avoid a cycle with demoData. */
import type { CableType, PortType, RackStyle } from '@/types'

export const DEFAULT_RACK_STYLE: RackStyle = {
  frame: '#1c2129',
  rail: '#39424f',
  interior: '#0d1117',
  showNumbers: true,
  enclosed: false,
}

/**
 * Capacity a rack may be set to. The backend accepts up to 100 U; the UI stops
 * at 48 — taller than any cabinet a homelab owns, and the number input's
 * `min`/`max` are only hints, so the store clamps to these for real.
 */
export const MIN_RACK_U = 1
export const MAX_RACK_U = 48

/**
 * Cables a single patch panel port accepts, front and rear.
 *
 * Every other port takes one: a switch jack really is one cable. A panel port
 * is a pass-through, and with only a front view to draw on both ends of it hang
 * off the same port.
 */
export const PATCH_PANEL_PORT_CABLES = 2

export const CABLE_COLORS: Record<CableType, string> = {
  ethernet: '#39d353',
  fiber: '#f0a500',
}

/**
 * Swatches offered when recolouring a patch — the sheaths a homelab actually
 * has on the shelf. Any other colour still goes in through the free-text field.
 */
export const CABLE_COLOR_PRESETS: string[] = [
  '#39d353', // green
  '#00d4ff', // cyan
  '#f0a500', // amber / fibre
  '#f85149', // red
  '#a855f7', // purple
  '#e3b341', // yellow
  '#3b82f6', // blue
  '#8b949e', // grey
  '#f2f2f2', // white
  '#161b22', // black
]

/** Property keys a cable is most often annotated with, offered as one-click adds. */
export const CABLE_PROPERTY_SUGGESTIONS = ['Length', 'VLAN', 'Speed', 'Category', 'Patch ref']

/** Cable type implied by the port a patch starts from. */
export const PORT_CABLE_TYPE: Record<PortType, CableType> = {
  rj45: 'ethernet',
  sfp: 'fiber',
  'sfp+': 'fiber',
}

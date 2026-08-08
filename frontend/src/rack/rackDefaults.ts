/** Shared defaults, kept out of the store to avoid a cycle with demoData. */
import type { CableType, PortType, RackStyle } from '@/types'

export const DEFAULT_RACK_STYLE: RackStyle = {
  frame: '#1c2129',
  rail: '#39424f',
  interior: '#0d1117',
  showNumbers: true,
  enclosed: false,
}

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

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

/** Cable type implied by the port a patch starts from. */
export const PORT_CABLE_TYPE: Record<PortType, CableType> = {
  rj45: 'ethernet',
  sfp: 'fiber',
  'sfp+': 'fiber',
}

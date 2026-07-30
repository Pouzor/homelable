/**
 * Rack canvas prototype — domain types.
 *
 * Front-only UX prototype. Nothing here is persisted server-side yet; the
 * shapes are meant to be lifted into `@/types` once the UX is validated.
 */

/** Horizontal grid inside a rack. 12 columns = full width, 6 = half, 4 = third. */
export const RACK_COLUMNS = 12

export type RackWidthStandard = '19' | '10'

/** 1U is at the bottom (real-world rails) or at the top (some diagram tools). */
export type RackNumbering = 'bottom-up' | 'top-down'

export interface RackStyle {
  /** Frame / chassis colour. */
  frame: string
  /** Rail strip colour. */
  rail: string
  /** Empty slot colour, seen between mounted gear. */
  interior: string
  /** Show the U number strip alongside the rails. */
  showNumbers: boolean
  /** Draw side panels (enclosed cabinet) instead of an open frame. */
  enclosed: boolean
}

export interface Rack {
  id: string
  name: string
  /** Total usable height in U. */
  uHeight: number
  widthStandard: RackWidthStandard
  numbering: RackNumbering
  style: RackStyle
  /** Free-text location label ("garage", "office closet"). */
  location?: string
  /** Position on the canvas. */
  position: { x: number; y: number }
}

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------

/** Only data ports for now — power cabling is out of v1. */
export type PortType = 'rj45' | 'sfp' | 'sfp+'

export interface Port {
  id: string
  label: string
  type: PortType
  /**
   * Position on the faceplate, expressed in faceplate-local unit coordinates
   * (0..1 on both axes) so a port keeps its spot at any zoom level.
   */
  x: number
  y: number
}

// ---------------------------------------------------------------------------
// Faceplates
// ---------------------------------------------------------------------------

export type FaceplateElement =
  | { kind: 'panel'; fill: string; stroke?: string }
  | { kind: 'vents'; x: number; y: number; w: number; h: number; cols: number; rows: number; fill?: string }
  | { kind: 'bays'; x: number; y: number; w: number; h: number; cols: number; rows: number; fill?: string }
  | { kind: 'strip'; x: number; y: number; w: number; h: number; fill: string }
  /**
   * Power outlets. Artwork only — outlets are drawn but never cabled, since
   * power is out of v1.
   */
  | { kind: 'outlets'; x: number; y: number; w: number; h: number; count: number }

export type FaceplateKind = 'device' | 'accessory'

/** Horizontal band reserved for the device name, in unit coordinates. */
export interface LabelBox {
  x: number
  w: number
}

export interface FaceplateTemplate {
  id: string
  label: string
  kind: FaceplateKind
  /** Category used to group the picker list. */
  group: string
  /** Suggested height in U when the template is applied. */
  uHeight: number
  /** Suggested width in rack columns (see RACK_COLUMNS). */
  colSpan: number
  /** Static artwork, drawn in faceplate-local unit coordinates (0..1). */
  elements: FaceplateElement[]
  /** Ports pre-filled on apply. The user can add/remove afterwards. */
  ports: Omit<Port, 'id'>[]
  /**
   * Patch-facing gear (switches, patch panels) always shows its ports; on
   * everything else ports only appear on hover, selection or in patch mode.
   */
  alwaysShowPorts?: boolean
  /** Name band. Ports and artwork must stay clear of it. */
  labelBox: LabelBox
  /** Port artwork size. Dense panels use 'sm'. */
  portSize?: 'sm' | 'md'
  /** Devices get a status LED; accessories do not. */
  statusLed?: boolean
}

// ---------------------------------------------------------------------------
// Mounted devices
// ---------------------------------------------------------------------------

export type DeviceStatus = 'online' | 'offline' | 'unknown'

export interface RackDevice {
  id: string
  rackId: string
  /**
   * Inventory node id this mount represents. Null for accessories (blank
   * panels, shelves) that exist only in the rack view.
   */
  nodeId: string | null
  label: string
  /** Lowest U occupied, 1-based, always counted from the bottom rail. */
  uStart: number
  uHeight: number
  /** Left edge on the 12-column grid, 0-based. */
  colStart: number
  colSpan: number
  faceplateId: string
  /** Overrides the faceplate panel fill when set. */
  color?: string
  status: DeviceStatus
  ports: Port[]
}

// ---------------------------------------------------------------------------
// Cabling
// ---------------------------------------------------------------------------

export type CableType = 'ethernet' | 'fiber'

export interface Cable {
  id: string
  type: CableType
  color: string
  label?: string
  from: { deviceId: string; portId: string }
  to: { deviceId: string; portId: string }
}

/** How the cabling overlay behaves. */
export type CableVisibility = 'hover' | 'always' | 'hidden'

// ---------------------------------------------------------------------------
// Inventory (fake, prototype only)
// ---------------------------------------------------------------------------

/** Subset of the network inventory that can physically live in a rack. */
export type RackableNodeType =
  | 'server'
  | 'proxmox'
  | 'switch'
  | 'router'
  | 'firewall'
  | 'nas'
  | 'ups'
  | 'patch_panel'
  | 'pdu'
  | 'generic'

export interface InventoryDevice {
  id: string
  label: string
  type: RackableNodeType
  ip?: string
  status: DeviceStatus
  /** Faceplate proposed when the device is dropped into a rack. */
  suggestedFaceplateId: string
}

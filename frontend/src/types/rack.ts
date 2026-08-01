/**
 * Rack canvas — domain types.
 *
 * A rack canvas is a design of `design_type: 'rack'`. These camelCase shapes are
 * what the store and components work with; `@/utils/rackSerializer` maps them to
 * and from the snake_case API payloads.
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
  /**
   * Vertical centre of the name band, 0..1, default 0.5.
   *
   * Rack gear wears its name across the middle. Tall desktop boxes do not —
   * their front is drive trays, and the badge sits on a strip at the bottom.
   * The status LED rides the same band.
   */
  y?: number
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
  /** Devices get a status LED; accessories do not. */
  statusLed?: boolean
}

// ---------------------------------------------------------------------------
// Mounted devices
// ---------------------------------------------------------------------------

export type DeviceStatus = 'online' | 'offline' | 'unknown'

/**
 * What a mount's Status field holds: a state the user pinned by hand, or `auto`
 * — "check device", i.e. follow the status check already configured on the
 * matching logical-canvas node (ping / http / ssh…). The rack runs no checker
 * of its own, so `auto` only means anything for a mount whose inventory entry
 * resolves to a node; it renders as `unknown` otherwise.
 */
export type MountStatus = DeviceStatus | 'auto'

export interface RackDevice {
  id: string
  rackId: string
  /**
   * Device Inventory entry this mount represents. Null for accessories (blank
   * panels, shelves) that exist only in the rack view.
   *
   * Unmounting never deletes the inventory entry — the inventory outlives both
   * the rack mount and any canvas node, which is the whole point of keying on it.
   */
  deviceId: string | null
  /**
   * Logical-canvas node for the same hardware, when one exists. Read-only here:
   * resolved by the backend from the inventory entry, used for live status and
   * for seeding cables from the network design's edges.
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
  /** Pinned state, or `auto` to follow the linked node's check. */
  status: MountStatus
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
// Inventory
// ---------------------------------------------------------------------------

/**
 * A Device Inventory entry offered to the rack tray.
 *
 * Sourced from the backend's `pending_devices` — the same list the Device
 * Inventory panel shows. Entries survive approval and node deletion, so racking
 * and unracking never mutates them.
 */
export interface InventoryDevice {
  id: string
  label: string
  /** `suggested_type` from discovery; free-form, may be unknown to the UI. */
  type: string | null
  ip?: string | null
  /** Live status of the matching canvas node, `unknown` when there is none. */
  status: DeviceStatus
  /** Matching canvas node, when the device is on a logical canvas. */
  nodeId: string | null
  /** Already mounted somewhere in this rack design. */
  racked: boolean
  /** Faceplate proposed when the device is dropped into a rack. */
  suggestedFaceplateId: string
}

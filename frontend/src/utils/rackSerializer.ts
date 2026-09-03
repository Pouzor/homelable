/**
 * Maps between the rack API payloads (snake_case, flat) and the domain shapes
 * the rack store works with (camelCase, nested position/endpoints).
 *
 * Mirrors what `canvasSerializer` does for nodes and edges.
 */
import { DEFAULT_RACK_STYLE, PORT_CABLE_TYPE, CABLE_COLORS } from '@/rack/rackDefaults'
import { suggestFaceplate } from '@/rack/faceplates'
import { RACK_COLUMNS } from '@/types'
import type {
  Cable,
  CableProperty,
  CableType,
  DeviceStatus,
  InventoryDevice,
  InventoryService,
  LinkedNodeInfo,
  MountStatus,
  Port,
  PortType,
  Rack,
  RackDevice,
  RackModel,
  RackNumbering,
  RackStyle,
  RackWidthStandard,
} from '@/types'

// ── API shapes ───────────────────────────────────────────────────────────────

export interface ApiRack {
  id: string
  design_id: string
  name: string
  u_height: number
  width_standard: string
  numbering: string
  location: string | null
  style: Record<string, unknown>
  pos_x: number
  pos_y: number
}

export interface ApiRackDevice {
  id: string
  design_id: string
  rack_id: string
  device_id: string | null
  node_id: string | null
  label: string
  u_start: number
  u_height: number
  col_start: number
  col_span: number
  faceplate_id: string
  color: string | null
  status: string
  ports: unknown[]
}

export interface ApiRackCable {
  id: string
  design_id: string
  from_device_id: string
  from_port_id: string
  to_device_id: string
  to_port_id: string
  type: string
  color: string
  label: string | null
  label_visible: boolean
  /** [{key, value, icon, visible}] — same records the logical canvas uses. */
  properties: CableProperty[]
}

export interface ApiRackState {
  racks: ApiRack[]
  devices: ApiRackDevice[]
  cables: ApiRackCable[]
  viewport: { x?: number; y?: number; zoom?: number }
}

export interface ApiInventoryItem {
  id: string
  label: string
  suggested_type: string | null
  ip: string | null
  status: string
  discovery_source: string | null
  node_id: string | null
  node_status: string | null
  racked: boolean
  // Technical detail, added after the first release of the endpoint — optional
  // so an older backend (or a fixture) still deserializes.
  mac?: string | null
  hostname?: string | null
  os?: string | null
  services?: { port?: number | null; name?: string | null }[] | null
  node_label?: string | null
  node_type?: string | null
  node_ip?: string | null
  node_mac?: string | null
  node_hostname?: string | null
  node_os?: string | null
  node_check_method?: string | null
  node_design_id?: string | null
  node_design_name?: string | null
  node_last_seen?: string | null
  // Rack modelisation the inventory row owns. Absent on an older backend, and
  // null on a device that has never been racked.
  rack_faceplate_id?: string | null
  rack_u_height?: number | null
  rack_col_span?: number | null
  rack_color?: string | null
  rack_ports?: unknown[] | null
}

export interface RackSavePayload {
  design_id: string
  racks: Omit<ApiRack, 'design_id'>[]
  devices: Omit<ApiRackDevice, 'design_id'>[]
  cables: Omit<ApiRackCable, 'design_id'>[]
  viewport: { x: number; y: number; zoom: number }
}

// ── Narrowing ────────────────────────────────────────────────────────────────

const WIDTH_STANDARDS: RackWidthStandard[] = ['19', '10']
const NUMBERINGS: RackNumbering[] = ['bottom-up', 'top-down']
const PORT_TYPES: PortType[] = ['rj45', 'sfp', 'sfp+']
const DEVICE_STATUSES: DeviceStatus[] = ['online', 'offline', 'unknown']

function asWidthStandard(v: string): RackWidthStandard {
  return (WIDTH_STANDARDS as string[]).includes(v) ? (v as RackWidthStandard) : '19'
}

function asNumbering(v: string): RackNumbering {
  return (NUMBERINGS as string[]).includes(v) ? (v as RackNumbering) : 'bottom-up'
}

function asStatus(v: string | null): DeviceStatus {
  return (DEVICE_STATUSES as (string | null)[]).includes(v) ? (v as DeviceStatus) : 'unknown'
}

/** A mount may also store `auto` — it follows the linked node's check. */
function asMountStatus(v: string | null): MountStatus {
  return v === 'auto' ? 'auto' : asStatus(v)
}

/** Style is free-form JSON on the wire; fill any key the server never wrote. */
function asStyle(raw: Record<string, unknown>): RackStyle {
  const pick = (key: keyof RackStyle) => raw[key]
  return {
    frame: typeof pick('frame') === 'string' ? (raw.frame as string) : DEFAULT_RACK_STYLE.frame,
    rail: typeof pick('rail') === 'string' ? (raw.rail as string) : DEFAULT_RACK_STYLE.rail,
    interior:
      typeof pick('interior') === 'string' ? (raw.interior as string) : DEFAULT_RACK_STYLE.interior,
    showNumbers:
      typeof pick('showNumbers') === 'boolean'
        ? (raw.showNumbers as boolean)
        : DEFAULT_RACK_STYLE.showNumbers,
    enclosed:
      typeof pick('enclosed') === 'boolean' ? (raw.enclosed as boolean) : DEFAULT_RACK_STYLE.enclosed,
  }
}

/** Ports round-trip as opaque JSON; drop anything that is not a usable port. */
function asPorts(raw: unknown[]): Port[] {
  const ports: Port[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const p = entry as Record<string, unknown>
    if (typeof p.id !== 'string') continue
    const type = typeof p.type === 'string' && (PORT_TYPES as string[]).includes(p.type)
      ? (p.type as PortType)
      : 'rj45'
    ports.push({
      id: p.id,
      label: typeof p.label === 'string' ? p.label : p.id,
      type,
      x: typeof p.x === 'number' ? p.x : 0.5,
      y: typeof p.y === 'number' ? p.y : 0.5,
    })
  }
  return ports
}

/**
 * Cable properties are opaque JSON on the wire. Anything missing a usable
 * key/value pair is dropped rather than rendered as an empty annotation.
 */
function asCableProperties(raw: unknown): CableProperty[] {
  if (!Array.isArray(raw)) return []
  const props: CableProperty[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const p = entry as Record<string, unknown>
    if (typeof p.key !== 'string' || !p.key.trim()) continue
    props.push({
      key: p.key,
      value: typeof p.value === 'string' ? p.value : String(p.value ?? ''),
      icon: typeof p.icon === 'string' ? p.icon : null,
      visible: p.visible !== false,
    })
  }
  return props
}

// ── API → domain ─────────────────────────────────────────────────────────────

export function toRack(api: ApiRack): Rack {
  return {
    id: api.id,
    name: api.name,
    uHeight: api.u_height,
    widthStandard: asWidthStandard(api.width_standard),
    numbering: asNumbering(api.numbering),
    style: asStyle(api.style ?? {}),
    location: api.location ?? undefined,
    position: { x: api.pos_x, y: api.pos_y },
  }
}

export function toRackDevice(api: ApiRackDevice): RackDevice {
  return {
    id: api.id,
    rackId: api.rack_id,
    deviceId: api.device_id,
    nodeId: api.node_id,
    label: api.label,
    uStart: api.u_start,
    uHeight: api.u_height,
    colStart: api.col_start,
    colSpan: api.col_span,
    faceplateId: api.faceplate_id,
    color: api.color ?? undefined,
    status: asMountStatus(api.status),
    ports: asPorts(api.ports ?? []),
  }
}

export function toCable(api: ApiRackCable): Cable {
  const type: CableType = api.type === 'fiber' ? 'fiber' : 'ethernet'
  return {
    id: api.id,
    type,
    color: api.color || CABLE_COLORS[type],
    label: api.label ?? undefined,
    labelVisible: api.label_visible === true,
    properties: asCableProperties(api.properties),
    from: { deviceId: api.from_device_id, portId: api.from_port_id },
    to: { deviceId: api.to_device_id, portId: api.to_port_id },
  }
}

/** Drops the records with neither a port nor a name — they print as an empty chip. */
function asServices(raw: ApiInventoryItem['services']): InventoryService[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((s) => ({
      port: typeof s?.port === 'number' ? s.port : null,
      name: s?.name ? String(s.name) : null,
    }))
    .filter((s) => s.port !== null || s.name !== null)
}

/** The node half of an inventory row, when the backend matched one. */
function asLinkedNode(api: ApiInventoryItem): LinkedNodeInfo | null {
  if (!api.node_id) return null
  return {
    id: api.node_id,
    label: api.node_label ?? null,
    type: api.node_type ?? null,
    ip: api.node_ip ?? null,
    mac: api.node_mac ?? null,
    hostname: api.node_hostname ?? null,
    os: api.node_os ?? null,
    checkMethod: api.node_check_method ?? null,
    designId: api.node_design_id ?? null,
    designName: api.node_design_name ?? null,
    lastSeen: api.node_last_seen ?? null,
  }
}

/**
 * The device's saved front panel, or null when it has never been modelled.
 *
 * `rack_faceplate_id` is the flag the backend sets on the first save of a mount;
 * without it there is nothing to reuse and the tray falls back to the plate
 * suggested by the device type.
 */
function asRackModel(api: ApiInventoryItem): RackModel | null {
  if (!api.rack_faceplate_id) return null
  return {
    faceplateId: api.rack_faceplate_id,
    uHeight: typeof api.rack_u_height === 'number' ? api.rack_u_height : null,
    colSpan: typeof api.rack_col_span === 'number' ? api.rack_col_span : null,
    color: api.rack_color ?? null,
    ports: asPorts(Array.isArray(api.rack_ports) ? api.rack_ports : []),
  }
}

export function toInventoryDevice(api: ApiInventoryItem): InventoryDevice {
  return {
    id: api.id,
    label: api.label,
    type: api.suggested_type,
    discoverySource: api.discovery_source,
    ip: api.ip,
    mac: api.mac ?? null,
    hostname: api.hostname ?? null,
    os: api.os ?? null,
    services: asServices(api.services),
    // The inventory row itself is only pending/approved; live status comes from
    // the linked canvas node, if any.
    status: asStatus(api.node_status),
    nodeId: api.node_id,
    node: asLinkedNode(api),
    racked: api.racked,
    suggestedFaceplateId: suggestFaceplate(api.suggested_type),
    rackModel: asRackModel(api),
  }
}

// ── Domain → API ─────────────────────────────────────────────────────────────

export function fromRack(rack: Rack): Omit<ApiRack, 'design_id'> {
  return {
    id: rack.id,
    name: rack.name,
    u_height: rack.uHeight,
    width_standard: rack.widthStandard,
    numbering: rack.numbering,
    location: rack.location ?? null,
    style: { ...rack.style },
    pos_x: rack.position.x,
    pos_y: rack.position.y,
  }
}

export function fromRackDevice(device: RackDevice): Omit<ApiRackDevice, 'design_id'> {
  const colStart = Math.min(Math.max(device.colStart, 0), RACK_COLUMNS - 1)
  return {
    id: device.id,
    rack_id: device.rackId,
    device_id: device.deviceId,
    node_id: device.nodeId,
    label: device.label,
    u_start: device.uStart,
    u_height: device.uHeight,
    col_start: colStart,
    // Clamped against the start, not against the grid on its own: 11 + 12 is
    // two legal fields adding up to column 23 of 12, which the backend now
    // rejects — the whole save 422s over one device.
    col_span: Math.min(Math.max(device.colSpan, 1), RACK_COLUMNS - colStart),
    faceplate_id: device.faceplateId,
    color: device.color ?? null,
    status: device.status,
    ports: device.ports,
  }
}

export function fromCable(cable: Cable): Omit<ApiRackCable, 'design_id'> {
  return {
    id: cable.id,
    from_device_id: cable.from.deviceId,
    from_port_id: cable.from.portId,
    to_device_id: cable.to.deviceId,
    to_port_id: cable.to.portId,
    type: cable.type,
    color: cable.color || CABLE_COLORS[cable.type],
    label: cable.label ?? null,
    label_visible: cable.labelVisible === true,
    properties: cable.properties ?? [],
  }
}

export function buildSavePayload(
  designId: string,
  racks: Rack[],
  devices: RackDevice[],
  cables: Cable[],
  viewport: { x: number; y: number; zoom: number },
): RackSavePayload {
  const rackIds = new Set(racks.map((r) => r.id))
  const keptDevices = devices.filter((d) => rackIds.has(d.rackId))
  const deviceIds = new Set(keptDevices.map((d) => d.id))
  return {
    design_id: designId,
    racks: racks.map(fromRack),
    devices: keptDevices.map(fromRackDevice),
    // The backend rejects a cable whose endpoints are not in the payload, so
    // drop dangling ones here rather than failing the whole save.
    cables: cables
      .filter((c) => deviceIds.has(c.from.deviceId) && deviceIds.has(c.to.deviceId))
      .map(fromCable),
    viewport,
  }
}

/** Cable type implied by the port a patch starts from. */
export function cableTypeForPort(type: PortType): CableType {
  return PORT_CABLE_TYPE[type]
}

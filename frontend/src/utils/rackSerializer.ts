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
  MountStatus,
  Port,
  PortType,
  Rack,
  RackDevice,
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

export function toInventoryDevice(api: ApiInventoryItem): InventoryDevice {
  return {
    id: api.id,
    label: api.label,
    type: api.suggested_type,
    ip: api.ip,
    // The inventory row itself is only pending/approved; live status comes from
    // the linked canvas node, if any.
    status: asStatus(api.node_status),
    nodeId: api.node_id,
    racked: api.racked,
    suggestedFaceplateId: suggestFaceplate(api.suggested_type),
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
  return {
    id: device.id,
    rack_id: device.rackId,
    device_id: device.deviceId,
    node_id: device.nodeId,
    label: device.label,
    u_start: device.uStart,
    u_height: device.uHeight,
    col_start: Math.min(Math.max(device.colStart, 0), RACK_COLUMNS - 1),
    col_span: Math.min(Math.max(device.colSpan, 1), RACK_COLUMNS),
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

/**
 * A sample inventory + a pre-filled rack, offered on an empty rack canvas and
 * used as fixtures by the rack tests. Ids are fixed strings (not UUIDs) to keep
 * tests readable.
 *
 * `inv-*` ids stand in for Device Inventory entries, `node-*` for the matching
 * canvas nodes — the same two links a real mount carries.
 */
import { getFaceplate } from './faceplates'
import { CABLE_COLORS, DEFAULT_RACK_STYLE } from './rackDefaults'
import type { Cable, CableType, InventoryDevice, Port, Rack, RackDevice } from '@/types'

let portSeq = 0
function withIds(ports: Omit<Port, 'id'>[], deviceId: string): Port[] {
  return ports.map((p) => ({ ...p, id: `${deviceId}-p${portSeq++}` }))
}

interface DemoInventorySpec {
  id: string
  label: string
  type: string
  ip?: string
  status: InventoryDevice['status']
  suggestedFaceplateId: string
  /** Omitted for gear that was never placed on a logical canvas. */
  onCanvas?: false
}

const DEMO_INVENTORY: DemoInventorySpec[] = [
  { id: 'inv-pve1', label: 'pve-01', type: 'proxmox', ip: '192.168.1.10', status: 'online', suggestedFaceplateId: 'server-2u-bays' },
  { id: 'inv-pve2', label: 'pve-02', type: 'proxmox', ip: '192.168.1.11', status: 'online', suggestedFaceplateId: 'server-1u-bays' },
  { id: 'inv-nuc1', label: 'nuc-k3s-a', type: 'server', ip: '192.168.1.21', status: 'online', suggestedFaceplateId: 'sff-half' },
  { id: 'inv-nuc2', label: 'nuc-k3s-b', type: 'server', ip: '192.168.1.22', status: 'online', suggestedFaceplateId: 'sff-half' },
  { id: 'inv-pi1', label: 'pi-dns', type: 'server', ip: '192.168.1.31', status: 'online', suggestedFaceplateId: 'mini-third' },
  { id: 'inv-pi2', label: 'pi-backup', type: 'server', ip: '192.168.1.32', status: 'offline', suggestedFaceplateId: 'mini-third' },
  { id: 'inv-sw24', label: 'sw-core-24', type: 'switch', ip: '192.168.1.2', status: 'online', suggestedFaceplateId: 'switch-24' },
  { id: 'inv-sw8', label: 'sw-lab-8', type: 'switch', ip: '192.168.1.3', status: 'online', suggestedFaceplateId: 'switch-8' },
  { id: 'inv-fw', label: 'opnsense', type: 'firewall', ip: '192.168.1.1', status: 'online', suggestedFaceplateId: 'router-1u' },
  { id: 'inv-nas', label: 'nas-truenas', type: 'nas', ip: '192.168.1.40', status: 'online', suggestedFaceplateId: 'nas-2u' },
  { id: 'inv-jbod', label: 'jbod-shelf', type: 'server', ip: '192.168.1.41', status: 'unknown', suggestedFaceplateId: 'server-4u-storage' },
  { id: 'inv-ups', label: 'ups-eaton', type: 'ups', ip: '192.168.1.50', status: 'online', suggestedFaceplateId: 'ups-2u' },
  // Dumb hardware: documented by hand, never on a logical canvas.
  { id: 'inv-pdu', label: 'pdu-main', type: 'generic', status: 'unknown', suggestedFaceplateId: 'pdu-1u', onCanvas: false },
  { id: 'inv-patch', label: 'patch-house', type: 'generic', status: 'unknown', suggestedFaceplateId: 'patch-24', onCanvas: false },
]

/** Canvas node id for an inventory entry, when it has one. */
export function demoNodeId(inventoryId: string): string | null {
  const spec = DEMO_INVENTORY.find((i) => i.id === inventoryId)
  if (!spec || spec.onCanvas === false) return null
  return `node-${inventoryId}`
}

export function demoInventory(): InventoryDevice[] {
  return DEMO_INVENTORY.map((spec) => ({
    id: spec.id,
    label: spec.label,
    type: spec.type,
    ip: spec.ip ?? null,
    status: spec.status,
    nodeId: demoNodeId(spec.id),
    racked: false,
    suggestedFaceplateId: spec.suggestedFaceplateId,
  }))
}

export function demoRacks(): Rack[] {
  return [
    {
      id: 'rack-main',
      name: 'Main rack',
      location: 'Garage',
      uHeight: 18,
      widthStandard: '19',
      numbering: 'bottom-up',
      style: { ...DEFAULT_RACK_STYLE },
      position: { x: 120, y: 60 },
    },
  ]
}

interface DemoMount {
  id: string
  /** Device Inventory entry; null for rack-only accessories. */
  deviceId: string | null
  label: string
  faceplateId: string
  uStart: number
  colStart?: number
  colSpan?: number
  status?: RackDevice['status']
}

/** Layout of the pre-filled rack, top (18U) down to the bottom. */
const DEMO_MOUNTS: DemoMount[] = [
  { id: 'dev-patch', deviceId: 'inv-patch', label: 'patch-house', faceplateId: 'patch-24', uStart: 18 },
  { id: 'dev-sw24', deviceId: 'inv-sw24', label: 'sw-core-24', faceplateId: 'switch-24', uStart: 17 },
  { id: 'dev-mgmt', deviceId: null, label: 'Cable manager', faceplateId: 'cable-manager-1u', uStart: 16 },
  { id: 'dev-fw', deviceId: 'inv-fw', label: 'opnsense', faceplateId: 'router-1u', uStart: 15 },
  // Two half-width mini PCs sharing 14U.
  { id: 'dev-nuc1', deviceId: 'inv-nuc1', label: 'nuc-k3s-a', faceplateId: 'sff-half', uStart: 14, colStart: 0, colSpan: 6 },
  { id: 'dev-nuc2', deviceId: 'inv-nuc2', label: 'nuc-k3s-b', faceplateId: 'sff-half', uStart: 14, colStart: 6, colSpan: 6 },
  // Three third-width nodes sharing 13U.
  { id: 'dev-pi1', deviceId: 'inv-pi1', label: 'pi-dns', faceplateId: 'mini-third', uStart: 13, colStart: 0, colSpan: 4 },
  { id: 'dev-pi2', deviceId: 'inv-pi2', label: 'pi-backup', faceplateId: 'mini-third', uStart: 13, colStart: 4, colSpan: 4, status: 'offline' },
  { id: 'dev-blank', deviceId: null, label: 'Blank', faceplateId: 'blank-1u', uStart: 13, colStart: 8, colSpan: 4 },
  { id: 'dev-pve1', deviceId: 'inv-pve1', label: 'pve-01', faceplateId: 'server-2u-bays', uStart: 11 },
  { id: 'dev-pve2', deviceId: 'inv-pve2', label: 'pve-02', faceplateId: 'server-1u-bays', uStart: 10 },
  { id: 'dev-nas', deviceId: 'inv-nas', label: 'nas-truenas', faceplateId: 'nas-2u', uStart: 8 },
  { id: 'dev-shelf', deviceId: null, label: 'Shelf', faceplateId: 'shelf-1u', uStart: 7 },
  { id: 'dev-pdu', deviceId: 'inv-pdu', label: 'pdu-main', faceplateId: 'pdu-1u', uStart: 3 },
  { id: 'dev-ups', deviceId: 'inv-ups', label: 'ups-eaton', faceplateId: 'ups-2u', uStart: 1 },
]

export function demoDevices(): RackDevice[] {
  portSeq = 0
  const inventory = demoInventory()
  return DEMO_MOUNTS.map((mount) => {
    const plate = getFaceplate(mount.faceplateId)
    const inv = mount.deviceId ? inventory.find((i) => i.id === mount.deviceId) : undefined
    return {
      id: mount.id,
      rackId: 'rack-main',
      deviceId: mount.deviceId,
      nodeId: mount.deviceId ? demoNodeId(mount.deviceId) : null,
      label: mount.label,
      uStart: mount.uStart,
      uHeight: plate.uHeight,
      colStart: mount.colStart ?? 0,
      colSpan: mount.colSpan ?? plate.colSpan,
      faceplateId: mount.faceplateId,
      status: mount.status ?? inv?.status ?? 'unknown',
      ports: withIds(plate.ports, mount.id),
    }
  })
}

/**
 * A few patch cables so the cabling overlay has something to show on boot.
 * Ports are picked by index into each device's generated port list.
 */
const DEMO_CABLE_SPECS: {
  from: [string, number]
  to: [string, number]
  type: CableType
  label?: string
}[] = [
  { from: ['dev-sw24', 0], to: ['dev-fw', 0], type: 'ethernet', label: 'WAN uplink' },
  { from: ['dev-sw24', 1], to: ['dev-pve1', 0], type: 'ethernet' },
  { from: ['dev-sw24', 2], to: ['dev-pve2', 0], type: 'ethernet' },
  { from: ['dev-sw24', 3], to: ['dev-nuc1', 0], type: 'ethernet' },
  { from: ['dev-sw24', 4], to: ['dev-nuc2', 0], type: 'ethernet' },
  // sw24 ports: 0..23 are RJ45, 24..25 are SFP+.
  { from: ['dev-sw24', 24], to: ['dev-nas', 2], type: 'fiber', label: '10G SAN' },
  { from: ['dev-patch', 0], to: ['dev-sw24', 12], type: 'ethernet', label: 'office' },
  { from: ['dev-patch', 1], to: ['dev-sw24', 13], type: 'ethernet', label: 'living room' },
]

export function demoCables(): Cable[] {
  const devices = demoDevices()
  const byId = new Map(devices.map((d) => [d.id, d]))
  const cables: Cable[] = []
  for (const [i, spec] of DEMO_CABLE_SPECS.entries()) {
    const from = byId.get(spec.from[0])?.ports[spec.from[1]]
    const to = byId.get(spec.to[0])?.ports[spec.to[1]]
    if (!from || !to) continue
    cables.push({
      id: `cable-${i}`,
      type: spec.type,
      color: CABLE_COLORS[spec.type],
      label: spec.label,
      from: { deviceId: spec.from[0], portId: from.id },
      to: { deviceId: spec.to[0], portId: to.id },
    })
  }
  return cables
}

/**
 * Sample "links already drawn on the logical canvas", keyed by canvas node id.
 * The real list comes from `networkLinks.ts`; this one backs the tests and the
 * sample canvas.
 */
export function demoNetworkLinks(): { from: string; to: string; type: CableType; label?: string }[] {
  return [
    { from: 'node-inv-sw8', to: 'node-inv-sw24', type: 'ethernet', label: 'lab uplink' },
    { from: 'node-inv-jbod', to: 'node-inv-nas', type: 'ethernet' },
    { from: 'node-inv-pi1', to: 'node-inv-sw24', type: 'ethernet' },
  ]
}

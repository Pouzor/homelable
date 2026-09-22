import type { Node } from '@xyflow/react'
import type { InventoryEntry, NodeData } from '@/types'

/**
 * What the Device Inventory row owns, as it appears on a canvas node.
 *
 * A node carries a full copy of these — they are hydrated from the row when the
 * canvas loads — so a save cannot tell "I edited this" from "the row moved on
 * since I loaded it" without a baseline. `changedFactFields` compares against
 * the values the canvas was given, and the save sends the answer as
 * `changed_facts` so the backend writes the edit rather than the snapshot.
 *
 * `status` / `last_seen` / `response_time_ms` are deliberately absent: the
 * status checker owns reachability, a canvas never edits it.
 */
export const DEVICE_FACT_FIELDS = [
  'label',
  'type',
  'hostname',
  'ip',
  'mac',
  'os',
  'notes',
  'cpu_count',
  'cpu_model',
  'ram_gb',
  'disk_gb',
  'check_method',
  'check_target',
  'show_hardware',
  'services',
  'properties',
  'ieee_address',
] as const

export type DeviceFactField = (typeof DEVICE_FACT_FIELDS)[number]

/** One node's device facts, each serialized so a deep value compares by value. */
export type FactsBaseline = Record<string, string>

const encode = (value: unknown): string => JSON.stringify(value ?? null)

/**
 * Which services and properties the node carries, ignoring how it draws them.
 *
 * Order and visibility belong to the node, not to the inventory row, so hiding
 * a service or dragging a property into place is not an edit to the device and
 * must not be reported as one — otherwise a rearranged canvas would push its
 * arrangement onto every other canvas showing the same device.
 *
 * A service is identified by its port, protocol, host and path, never by its
 * name — the same identity the backend's `_service_identity_key` uses. The name
 * is a label: the scanner guesses it, the user corrects it, and keying on it
 * made a rename look like a different service. `listArrangedForNode` would then
 * drop the entry the node drew and append the renamed one hidden, so correcting
 * a service in the Device Inventory made it vanish from every canvas (issue
 * #468). The host and the path are in for the opposite reason: one node behind
 * a reverse proxy serves several sites on 443, and keying on the port alone
 * collapsed them into one entry that then overwrote the row (issue #503). The
 * scanner writes neither, so neither can resurrect #468.
 *
 * A service with no port keeps the name, qualified the same way: nothing else
 * tells two of those apart.
 */
const keyOf = (item: Record<string, unknown>): string => {
  if ('key' in item) return String(item.key ?? '').toLowerCase()
  const { port, protocol } = item
  const host = String(item.host ?? '').trim().toLowerCase()
  // Anchored the way `getServiceUrl` renders it, so two entries the UI would
  // send to the same URL are one service.
  const raw = String(item.path ?? '').trim()
  const path = raw && raw !== '/' && !raw.startsWith('/') ? `/${raw}` : raw
  const site = `${host}|${path}`
  if (port === undefined || port === null || port === '') {
    return `None|${protocol ?? ''}|${String(item.service_name ?? '').toLowerCase()}|${site}`
  }
  return `${port}|${protocol ?? ''}|${site}`
}

const encodeFacts = (field: DeviceFactField, value: unknown): string => {
  if (field !== 'services' && field !== 'properties') return encode(value)
  const items = (Array.isArray(value) ? value : []).filter(
    (item): item is Record<string, unknown> => typeof item === 'object' && item !== null,
  )
  const bare = items.map((item) => {
    const rest = { ...item }
    delete rest.visible
    return rest
  })
  return encode([...bare].sort((a, b) => keyOf(a).localeCompare(keyOf(b))))
}

export function factsBaselineOf(data: Partial<NodeData>): FactsBaseline {
  const out: FactsBaseline = {}
  for (const field of DEVICE_FACT_FIELDS) out[field] = encodeFacts(field, data[field])
  return out
}

/** Baselines for a whole canvas, keyed by node id. */
export function factsBaselines(nodes: Node<NodeData>[]): Record<string, FactsBaseline> {
  const out: Record<string, FactsBaseline> = {}
  for (const n of nodes) out[n.id] = factsBaselineOf(n.data)
  return out
}

/**
 * The facts this node changed since its baseline was taken.
 *
 * No baseline means the node is new to the server (or predates the tracking), so
 * every fact it carries counts as changed — the row has nothing to lose.
 */
export function changedFactFields(
  data: Partial<NodeData>,
  baseline: FactsBaseline | undefined,
): DeviceFactField[] {
  if (!baseline) return [...DEVICE_FACT_FIELDS]
  return DEVICE_FACT_FIELDS.filter((field) => encodeFacts(field, data[field]) !== baseline[field])
}

/**
 * The port a service key names, the form the match falls back to.
 *
 * Identity carries the host and the path, so editing either in the Device
 * Inventory rewrites the key while the canvases drawing it still hold the old
 * one. Both spell the same port, so that is what they are matched on once the
 * exact key misses — otherwise the entry the node draws is dropped and the
 * edited one appended hidden, which is issue #468 in a new field. A port-less
 * service has no such form and keeps its key, as does a property — its key is
 * a name the user wrote, with no shape to read.
 */
const portKeyOf = (item: Record<string, unknown>): string => {
  const key = keyOf(item)
  if ('key' in item) return key
  const parts = key.split('|')
  if (parts.length < 2 || parts[0] === '' || parts[0] === 'None') return key
  return `${parts[0]}|${parts[1]}`
}

/**
 * The row's list, arranged the way this node already draws it.
 *
 * The facts are the row's, the order and the visibility are the node's, so an
 * edit made in the Device Inventory must not reshuffle a canvas or unhide what
 * it hid. Same rule the backend applies on read: what the node already lists
 * keeps its place and its flag, what the row gained since is appended hidden,
 * and what the row lost disappears.
 *
 * Matched one item at a time rather than by key alone: a row can hold two
 * services on one port, each its own site behind a reverse proxy (issue #503),
 * and each entry the node draws claims its own.
 */
export function listArrangedForNode<T extends Record<string, unknown>>(
  current: T[] | undefined,
  incoming: T[],
): T[] {
  if (!current?.length) return incoming
  const pools = new Map<string, number[]>()
  const add = (key: string, pos: number) => {
    const pool = pools.get(key)
    if (pool) pool.push(pos)
    else pools.set(key, [pos])
  }
  incoming.forEach((item, pos) => {
    const key = keyOf(item)
    add(key, pos)
    const port = portKeyOf(item)
    if (port !== key) add(port, pos)
  })
  const claimed = new Set<number>()
  const free = (key: string) => pools.get(key)?.find((p) => !claimed.has(p))
  const out: T[] = []
  for (const item of current) {
    const pos = free(keyOf(item)) ?? free(portKeyOf(item))
    if (pos === undefined) continue
    claimed.add(pos)
    const fresh = incoming[pos]
    out.push('visible' in item ? { ...fresh, visible: item.visible } : fresh)
  }
  incoming.forEach((item, pos) => {
    if (!claimed.has(pos)) out.push({ ...item, visible: false })
  })
  return out
}

/**
 * An inventory row as node data — what a node drawing this device should show.
 *
 * Used to push an edit made in the Device Inventory into the canvases already
 * on screen, so their in-memory copy stops being stale the moment it is edited
 * rather than at the next reload. Inventory-only fields (friendly_name, vendor,
 * model, lifecycle `status`…) are not node data and stay out.
 */
export function deviceFactsToNodeData(device: InventoryEntry): Partial<NodeData> {
  return {
    label: device.label ?? device.friendly_name ?? device.hostname ?? device.ip ?? 'device',
    ...(device.type ? { type: device.type as NodeData['type'] } : {}),
    hostname: device.hostname ?? undefined,
    ip: device.ip ?? undefined,
    mac: device.mac ?? undefined,
    os: device.os ?? undefined,
    notes: device.notes ?? undefined,
    cpu_count: device.cpu_count ?? undefined,
    cpu_model: device.cpu_model ?? undefined,
    ram_gb: device.ram_gb ?? undefined,
    disk_gb: device.disk_gb ?? undefined,
    check_method: device.check_method ?? undefined,
    check_target: device.check_target ?? undefined,
    show_hardware: device.show_hardware ?? false,
    services: device.services ?? [],
    properties: device.properties ?? [],
    ieee_address: device.ieee_address ?? undefined,
  }
}

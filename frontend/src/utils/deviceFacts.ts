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

export function factsBaselineOf(data: Partial<NodeData>): FactsBaseline {
  const out: FactsBaseline = {}
  for (const field of DEVICE_FACT_FIELDS) out[field] = encode(data[field])
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
  return DEVICE_FACT_FIELDS.filter((field) => encode(data[field]) !== baseline[field])
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

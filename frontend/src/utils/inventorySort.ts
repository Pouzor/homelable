/**
 * Device Inventory: display helpers shared by the card grid and the table, and
 * the table's column sort.
 */
import type { InventoryEntry, NodeType } from '@/types'
import { orderedSources } from '@/utils/deviceSources'

const COMMON_PORTS = new Set([22, 80, 443])

/**
 * What the device is. The curated `type` wins over the discovery guess: a
 * device drawn on a canvas only ever has the former, and an edit that retypes a
 * scanned row must not keep reading the scanner's opinion.
 */
export function deviceType(d: InventoryEntry): NodeType | null {
  return ((d.type ?? d.suggested_type) as NodeType) ?? null
}

function specialServiceName(d: InventoryEntry): string | undefined {
  const candidates = (d.services ?? []).filter(
    (s) => s.category != null && s.port != null && !COMMON_PORTS.has(s.port) && s.service_name,
  )
  // Deprioritize generic web category so apps like home assistant / jellyfin win
  const nonWeb = candidates.find((s) => s.category?.toLowerCase() !== 'web')
  return (nonWeb ?? candidates[0])?.service_name ?? undefined
}

export function deviceLabel(d: InventoryEntry): string {
  // Same precedence as the detail modal — the name the user gave it first.
  return d.label ?? d.friendly_name ?? d.hostname ?? specialServiceName(d) ?? d.ip ?? d.ieee_address ?? 'device'
}

/** Most recent sign of life: the device's own, else its canvas node's, else discovery. */
export function deviceLastSeen(d: InventoryEntry): string {
  return d.last_seen ?? d.node_last_seen ?? d.discovered_at
}

export type InventorySortKey =
  | 'name' | 'type' | 'source' | 'ip' | 'mac' | 'vendor' | 'services' | 'canvas' | 'seen'

export type SortDirection = 'asc' | 'desc'

export interface InventorySort {
  key: InventorySortKey
  dir: SortDirection
}

/** IPv4 as a sortable number, so 10.0.0.9 comes before 10.0.0.10. Null for anything else. */
export function ipv4ToNumber(ip: string | null | undefined): number | null {
  if (!ip) return null
  const parts = ip.trim().split('.')
  if (parts.length !== 4) return null
  let n = 0
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null
    const v = Number(p)
    if (v > 255) return null
    n = n * 256 + v
  }
  return n
}

type SortValue = string | number | null

function sortValue(d: InventoryEntry, key: InventorySortKey): SortValue {
  switch (key) {
    case 'name': return deviceLabel(d).toLowerCase()
    case 'type': return deviceType(d)
    case 'source': return orderedSources(d)[0] ?? null
    case 'ip': return ipv4ToNumber(d.ip) ?? (d.ip ? d.ip.toLowerCase() : null)
    case 'mac': return d.mac ? d.mac.toLowerCase() : null
    case 'vendor': return d.vendor ? d.vendor.toLowerCase() : null
    case 'services': return d.services?.length ?? 0
    case 'canvas': return d.canvas_count ?? 0
    case 'seen': {
      const t = new Date(deviceLastSeen(d)).getTime()
      return Number.isNaN(t) ? null : t
    }
  }
}

function compareValues(a: SortValue, b: SortValue): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  // Numbers (parsed IPv4) before free-form strings (IPv6, hostnames).
  if (typeof a === 'number') return -1
  if (typeof b === 'number') return 1
  return String(a).localeCompare(String(b), undefined, { numeric: true })
}

/**
 * Stable sort by one column. Empty values always sink to the bottom whatever
 * the direction — a reversed list of blanks first is never what anyone wants.
 * Ties fall back to the name so the order is deterministic.
 */
export function sortDevices(devices: InventoryEntry[], sort: InventorySort): InventoryEntry[] {
  const sign = sort.dir === 'asc' ? 1 : -1
  return devices
    .map((d, i) => ({ d, i, v: sortValue(d, sort.key), name: deviceLabel(d).toLowerCase() }))
    .sort((x, y) => {
      if (x.v == null && y.v == null) return x.i - y.i
      if (x.v == null) return 1
      if (y.v == null) return -1
      const c = compareValues(x.v, y.v)
      if (c !== 0) return c * sign
      const n = x.name.localeCompare(y.name)
      return n !== 0 ? n : x.i - y.i
    })
    .map((x) => x.d)
}

/** Clicking the active column flips it; a new column starts ascending (newest / most first for dates and counts). */
export function nextSort(current: InventorySort, key: InventorySortKey): InventorySort {
  if (current.key === key) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
  const descFirst = key === 'seen' || key === 'canvas' || key === 'services'
  return { key, dir: descFirst ? 'desc' : 'asc' }
}

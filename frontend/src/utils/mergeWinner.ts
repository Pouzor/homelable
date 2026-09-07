import type { InventoryEntry } from '@/types'

/** The name the inventory prints for a device — the one the user gave it first. */
export function deviceName(d: InventoryEntry): string {
  return d.label ?? d.friendly_name ?? d.hostname ?? d.ip ?? d.ieee_address ?? 'device'
}

/**
 * The row the others should fold into, by default.
 *
 * Mirrors the backend's own precedence (`device_merge._pick_winner`): an IEEE
 * first — the Proxmox import and the mesh link graph key on it, so that row is
 * where every other writer comes back — then a row that is already drawn on a
 * canvas, then the oldest. Only a suggestion: the user picks in the end.
 */
export function suggestWinner(devices: InventoryEntry[]): string | undefined {
  return [...devices].sort((a, b) => (
    (a.ieee_address ? 0 : 1) - (b.ieee_address ? 0 : 1)
    || ((b.canvas_count ?? 0) > 0 ? 1 : 0) - ((a.canvas_count ?? 0) > 0 ? 1 : 0)
    || a.discovered_at.localeCompare(b.discovered_at)
    || a.id.localeCompare(b.id)
  ))[0]?.id
}

/** How much a row knows — shown so the user can tell the rich one from the stub. */
export function factCount(d: InventoryEntry): number {
  const scalars = [d.ip, d.mac, d.hostname, d.os, d.vendor, d.model, d.notes, d.ieee_address]
  return scalars.filter(Boolean).length + (d.services?.length ?? 0) + (d.properties?.length ?? 0)
}

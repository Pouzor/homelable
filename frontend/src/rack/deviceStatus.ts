/**
 * Where a mount's status LED gets its colour.
 *
 * A mount stores a `MountStatus`: three states the user pins by hand, plus
 * `auto` — "check device". The rack has no status checker of its own; the one
 * that already runs is the node-level one on the logical canvas (ping, http,
 * ssh, …). The backend reports that node's live state on every Device Inventory
 * row (`node_status`), so `auto` resolves through the inventory entry the mount
 * points at, and falls back to `unknown` when there is no node behind it.
 */
import type { DeviceStatus, InventoryDevice, MountStatus, RackDevice } from '@/types'

/** Every value the Status select offers, `auto` first. */
export const MOUNT_STATUSES: MountStatus[] = ['auto', 'online', 'offline', 'unknown']

/**
 * Whether "check device" is worth offering: only an inventory entry the backend
 * matched to a canvas node carries a check to follow.
 */
export function canFollowNode(entry: InventoryDevice | undefined | null): boolean {
  return !!entry?.nodeId
}

/** The colour to draw, given what the mount stores and the current inventory. */
export function resolveDeviceStatus(
  device: Pick<RackDevice, 'status' | 'deviceId'>,
  inventory: InventoryDevice[],
): DeviceStatus {
  if (device.status !== 'auto') return device.status
  if (!device.deviceId) return 'unknown'
  return inventory.find((i) => i.id === device.deviceId)?.status ?? 'unknown'
}

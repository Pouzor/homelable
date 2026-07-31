/**
 * "Rackable" — a Device Inventory entry that describes a piece of hardware you
 * could screw into a rack, as opposed to something virtual, mesh-attached or
 * purely a canvas annotation.
 *
 * An exclusion list, not an allow list: new hardware types should be rackable
 * by default and only the obviously non-physical kinds opt out. A device with
 * no `suggested_type` at all (a bare IP-scan hit) stays rackable — the scanner
 * simply has not named it yet.
 *
 * Mirrors `_UNRACKABLE_TYPES` in `backend/app/api/routes/racks.py`, which is
 * what `GET /api/v1/racks/inventory` filters on; `test_rackable_sync.py` fails
 * the backend suite when the two drift. Keeping them equal is what makes the
 * inventory modal's Rackable filter show exactly the rows the rack tray offers.
 */
import type { PendingDevice } from '@/components/modals/PendingDeviceModal'

export const UNRACKABLE_TYPES = new Set([
  'vm',
  'lxc',
  'docker_container',
  'mobile',
  'laptop',
  'light',
  'socket',
  'load',
  'groupRect',
  'group',
  'text',
  'zigbee_coordinator',
  'zigbee_router',
  'zigbee_enddevice',
  'zwave_coordinator',
  'zwave_router',
  'zwave_enddevice',
])

export function isRackable(device: PendingDevice): boolean {
  return !device.suggested_type || !UNRACKABLE_TYPES.has(device.suggested_type)
}

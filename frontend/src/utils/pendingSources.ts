/** Discovery-source bucketing for pending inventory devices.
 *
 * A device may be observed by more than one discovery path (e.g. an IP scan and
 * a Proxmox import); `discovery_sources` holds every one. These helpers map that
 * raw list to the UI's filter/badge buckets so a merged device shows under each
 * matching filter and renders one badge per source.
 */
import type { PendingDevice } from '@/components/modals/PendingDeviceModal'

export type SourceBucket = 'ip' | 'zigbee' | 'zwave' | 'proxmox'

export const SOURCE_META: Record<SourceBucket, { color: string; label: string }> = {
  zigbee: { color: '#00d4ff', label: 'ZIGBEE' },
  zwave: { color: '#ff6e00', label: 'Z-WAVE' },
  proxmox: { color: '#e57000', label: 'PROXMOX' },
  ip: { color: '#a855f7', label: 'IP' },
}

// Stable badge order (IP first — it's the primary discovery path).
const SOURCE_ORDER: SourceBucket[] = ['ip', 'proxmox', 'zigbee', 'zwave']

/** Every source bucket that has observed this device. A device found by both an
 *  IP scan and a Proxmox import returns {ip, proxmox}. */
export function sourceBuckets(d: PendingDevice): Set<SourceBucket> {
  const raw = d.discovery_sources && d.discovery_sources.length > 0
    ? d.discovery_sources
    : d.discovery_source ? [d.discovery_source] : []
  const buckets = new Set<SourceBucket>()
  for (const s of raw) {
    if (s === 'zwave') buckets.add('zwave')
    else if (s === 'zigbee') buckets.add('zigbee')
    else if (s === 'proxmox') buckets.add('proxmox')
    else buckets.add('ip') // arp / mdns / anything else → IP scan
  }
  if (buckets.size === 0) {
    // No source recorded — legacy heuristic (mesh rows carry a non-pve ieee).
    if (d.ieee_address && !d.ieee_address.startsWith('pve-')) buckets.add('zigbee')
    else buckets.add('ip')
  }
  return buckets
}

/** Ordered bucket list for badge rendering. */
export function orderedSources(d: PendingDevice): SourceBucket[] {
  const buckets = sourceBuckets(d)
  return SOURCE_ORDER.filter((b) => buckets.has(b))
}

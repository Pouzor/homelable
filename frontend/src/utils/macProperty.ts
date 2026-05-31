import type { NodeProperty } from '@/types'

/** Build the MAC address property row shown in the right panel.
 * Hidden by default — the user opts in to showing it on the canvas card.
 * Matches backend `build_mac_property`. Returns an empty array when no MAC. */
export function buildMacProperty(mac?: string | null): NodeProperty[] {
  if (!mac) return []
  return [{ key: 'MAC', value: mac, icon: null, visible: false }]
}

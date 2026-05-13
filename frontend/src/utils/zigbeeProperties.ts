import type { NodeProperty, NodeType } from '@/types'

const ZIGBEE_TYPES: NodeType[] = ['zigbee_coordinator', 'zigbee_router', 'zigbee_enddevice']

export function isZigbeeType(type: NodeType | string | undefined | null): boolean {
  return !!type && (ZIGBEE_TYPES as string[]).includes(type)
}

/** Build the IEEE/Vendor/Model/LQI property rows shown in the right panel.
 * Matches backend `build_zigbee_properties`. */
export function buildZigbeeProperties(input: {
  ieee_address?: string | null
  vendor?: string | null
  model?: string | null
  lqi?: number | null
}): NodeProperty[] {
  const props: NodeProperty[] = []
  if (input.ieee_address) props.push({ key: 'IEEE', value: input.ieee_address, icon: null, visible: true })
  if (input.vendor) props.push({ key: 'Vendor', value: input.vendor, icon: null, visible: true })
  if (input.model) props.push({ key: 'Model', value: input.model, icon: null, visible: true })
  if (input.lqi != null) props.push({ key: 'LQI', value: String(input.lqi), icon: null, visible: true })
  return props
}

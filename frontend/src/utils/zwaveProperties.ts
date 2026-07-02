import type { NodeProperty, NodeType } from '@/types'

const ZWAVE_TYPES: NodeType[] = ['zwave_coordinator', 'zwave_router', 'zwave_enddevice']

export function isZwaveType(type: NodeType | string | undefined | null): boolean {
  return !!type && (ZWAVE_TYPES as string[]).includes(type)
}

/** Build the Z-Wave ID/Vendor/Model property rows shown in the right panel.
 * Matches backend `build_zwave_properties` (no LQI — Z-Wave has none). */
export function buildZwaveProperties(input: {
  ieee_address?: string | null
  vendor?: string | null
  model?: string | null
}): NodeProperty[] {
  const props: NodeProperty[] = []
  if (input.ieee_address) props.push({ key: 'Z-Wave ID', value: input.ieee_address, icon: null, visible: false })
  if (input.vendor) props.push({ key: 'Vendor', value: input.vendor, icon: null, visible: false })
  if (input.model) props.push({ key: 'Model', value: input.model, icon: null, visible: false })
  return props
}

import type { NodeType } from '@/types'

/**
 * Node types offered by the type pickers, grouped for the select.
 *
 * Shared by `NodeModal` (canvas node) and `InventoryDeviceModal` (inventory
 * row) so a device gets the same vocabulary wherever it is typed. Canvas
 * furniture that is not a device (`group`, `text`) is deliberately absent —
 * those are created from the toolbar, never picked here.
 */
export const NODE_TYPE_GROUPS: { label: string; types: NodeType[] }[] = [
  { label: 'Hardware',       types: ['isp', 'router', 'firewall', 'switch', 'server', 'nas', 'kvm', 'ap', 'printer'] },
  { label: 'Virtualization', types: ['proxmox', 'vm', 'lxc', 'docker_host', 'docker_container'] },
  { label: 'IoT',            types: ['iot', 'camera', 'cpl'] },
  { label: 'Zigbee',         types: ['zigbee_coordinator', 'zigbee_router', 'zigbee_enddevice'] },
  { label: 'Z-Wave',         types: ['zwave_coordinator', 'zwave_router', 'zwave_enddevice'] },
  { label: 'Personal',       types: ['computer', 'laptop', 'mobile'] },
  { label: 'Electrical',     types: ['grid', 'ups', 'battery', 'generator', 'solar_panel', 'inverter', 'circuit_breaker', 'contactor', 'electrical_switch', 'socket', 'light', 'meter', 'transformer', 'load'] },
  { label: 'Generic',        types: ['generic', 'groupRect'] },
]

/** Same list without `groupRect` — an inventory row describes real hardware. */
export const DEVICE_TYPE_GROUPS: { label: string; types: NodeType[] }[] = NODE_TYPE_GROUPS.map((g) =>
  g.types.includes('groupRect') ? { ...g, types: g.types.filter((t) => t !== 'groupRect') } : g
)

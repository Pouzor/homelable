export type NodeType =
  | 'isp'
  | 'router'
  | 'switch'
  | 'server'
  | 'proxmox'
  | 'vm'
  | 'lxc'
  | 'nas'
  | 'iot'
  | 'ap'
  | 'camera'
  | 'printer'
  | 'computer'
  | 'generic'

export type EdgeType = 'ethernet' | 'wifi' | 'iot' | 'vlan' | 'virtual' | 'cluster'

export type NodeStatus = 'online' | 'offline' | 'pending' | 'unknown'

export type CheckMethod = 'ping' | 'http' | 'https' | 'tcp' | 'ssh' | 'prometheus' | 'health' | 'none'

export interface ServiceInfo {
  port: number
  protocol: 'tcp' | 'udp'
  service_name: string
  icon?: string
  category?: string
}

export interface NodeData extends Record<string, unknown> {
  label: string
  type: NodeType
  hostname?: string
  ip?: string
  mac?: string
  os?: string
  status: NodeStatus
  check_method?: CheckMethod
  check_target?: string
  services: ServiceInfo[]
  last_seen?: string
  response_time_ms?: number
  notes?: string
  parent_id?: string
  container_mode?: boolean
  custom_colors?: { border?: string; background?: string; icon?: string }
  custom_icon?: string
}

export type EdgePathStyle = 'bezier' | 'smooth'

export interface EdgeData extends Record<string, unknown> {
  type: EdgeType
  label?: string
  vlan_id?: number
  speed?: string
  custom_color?: string
  path_style?: EdgePathStyle
}

export const NODE_TYPE_LABELS: Record<NodeType, string> = {
  isp: 'ISP / Modem',
  router: 'Router',
  switch: 'Switch',
  server: 'Server',
  proxmox: 'Proxmox VE',
  vm: 'Virtual Machine',
  lxc: 'LXC Container',
  nas: 'NAS',
  iot: 'IoT Device',
  ap: 'Access Point',
  camera: 'Camera',
  printer: 'Printer',
  computer: 'Computer',
  generic: 'Generic Device',
}

export const STATUS_COLORS: Record<NodeStatus, string> = {
  online: '#39d353',
  offline: '#f85149',
  pending: '#e3b341',
  unknown: '#8b949e',
}

export const EDGE_TYPE_LABELS: Record<EdgeType, string> = {
  ethernet: 'Ethernet',
  wifi: 'Wi-Fi',
  iot: 'IoT / Zigbee',
  vlan: 'VLAN',
  virtual: 'Virtual',
  cluster: 'Cluster',
}

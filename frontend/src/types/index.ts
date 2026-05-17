export type NodeType =
  | 'isp'
  | 'router'
  | 'firewall'
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
  | 'cpl'
  | 'docker_host'
  | 'docker_container'
  | 'generic'
  | 'groupRect'
  | 'group'
  | 'zigbee_coordinator'
  | 'zigbee_router'
  | 'zigbee_enddevice'

export type TextPosition =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'middle-left'
  | 'center'
  | 'middle-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right'

export type EdgeType = 'ethernet' | 'wifi' | 'iot' | 'vlan' | 'virtual' | 'cluster'

export type NodeStatus = 'online' | 'offline' | 'pending' | 'unknown'

export type CheckMethod = 'ping' | 'http' | 'https' | 'tcp' | 'ssh' | 'prometheus' | 'health' | 'none'

export interface ServiceInfo {
  port?: number
  protocol: 'tcp' | 'udp'
  service_name: string
  path?: string
  icon?: string
  category?: string
}

export interface NodeProperty {
  key: string
  value: string
  icon: string | null
  visible: boolean
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
  cpu_count?: number
  cpu_model?: string
  ram_gb?: number
  disk_gb?: number
  show_hardware?: boolean
  properties?: NodeProperty[]
  parent_id?: string
  container_mode?: boolean
  custom_colors?: {
    border?: string
    background?: string
    icon?: string
    // Group rectangle extras (type === 'groupRect')
    text_color?: string
    text_position?: TextPosition
    font?: string
    border_style?: 'solid' | 'dashed' | 'dotted' | 'double' | 'none'
    border_width?: number
    label_position?: 'inside' | 'outside'
    text_size?: number
    z_order?: number
    show_border?: boolean
    width?: number
    height?: number
  }
  custom_icon?: string
  /** Number of bottom connection points, 1..48. Default 1 (centered). */
  bottom_handles?: number
}

export type EdgePathStyle = 'bezier' | 'smooth'

export interface Waypoint {
  x: number
  y: number
}

export interface EdgeData extends Record<string, unknown> {
  type: EdgeType
  label?: string
  vlan_id?: number
  speed?: string
  custom_color?: string
  path_style?: EdgePathStyle
  animated?: boolean | 'snake' | 'flow' | 'basic' | 'none'
  waypoints?: Waypoint[]
}

export const NODE_TYPE_LABELS: Record<NodeType, string> = {
  isp: 'ISP / Modem',
  router: 'Router',
  firewall: 'Firewall',
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
  cpl: 'CPL / Powerline',
  docker_host: 'Docker Host',
  docker_container: 'Docker Container',
  generic: 'Generic Device',
  groupRect: 'Group Rectangle',
  group: 'Node Group',
  zigbee_coordinator: 'Zigbee Coordinator',
  zigbee_router: 'Zigbee Router',
  zigbee_enddevice: 'Zigbee End Device',
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

export interface NodeTypeStyle {
  borderColor: string
  borderOpacity: number
  bgColor: string
  bgOpacity: number
  iconColor: string
  iconOpacity: number
  width: number
  height: number
}

export interface EdgeTypeStyle {
  color: string
  opacity: number
  pathStyle: EdgePathStyle
  animated: 'none' | 'snake' | 'flow' | 'basic'
}

export interface CustomStyleDef {
  nodes: Partial<Record<NodeType, NodeTypeStyle>>
  edges: Partial<Record<EdgeType, EdgeTypeStyle>>
}

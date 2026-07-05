export type DesignType = 'network' | 'electrical'

export interface Design {
  id: string
  name: string
  design_type: DesignType
  /** Lucide icon key (see utils/designIcons). User-chosen; may be null on legacy rows. */
  icon?: string | null
  created_at: string
  updated_at: string
}

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
  | 'laptop'
  | 'mobile'
  | 'cpl'
  | 'docker_host'
  | 'docker_container'
  | 'generic'
  | 'groupRect'
  | 'group'
  | 'text'
  | 'zigbee_coordinator'
  | 'zigbee_router'
  | 'zigbee_enddevice'
  | 'zwave_coordinator'
  | 'zwave_router'
  | 'zwave_enddevice'
  | 'grid'
  | 'ups'
  | 'battery'
  | 'generator'
  | 'solar_panel'
  | 'inverter'
  | 'circuit_breaker'
  | 'contactor'
  | 'electrical_switch'
  | 'socket'
  | 'light'
  | 'meter'
  | 'transformer'
  | 'load'

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

export type EdgeType = 'ethernet' | 'wifi' | 'iot' | 'vlan' | 'virtual' | 'cluster' | 'fibre' | 'electrical'

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

export type ServiceStatus = 'online' | 'offline' | 'unknown'

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
  last_scan?: string
  created_at?: string
  updated_at?: string
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
    show_services?: boolean
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
  /**
   * Collapsible zone state (type === 'groupRect'). When true, the zone hides
   * its descendants on the canvas. Persisted via `custom_colors.collapsed`
   * round-trip for back-compat with older saves.
   */
  collapsed?: boolean
  custom_icon?: string
  /** Number of top connection points, 0..64. Default 1. */
  top_handles?: number
  /** Number of bottom connection points, 0..64. Default 1 (centered). */
  bottom_handles?: number
  /** Number of left connection points, 0..64. Default 0 (opt-in). */
  left_handles?: number
  /** Number of right connection points, 0..64. Default 0 (opt-in). */
  right_handles?: number
  /** Show a port number (1..N) next to each connection point. */
  show_port_numbers?: boolean
  /** Text node content (type === 'text') */
  text_content?: string
}

export type EdgePathStyle = 'bezier' | 'smooth'

/**
 * Endpoint marker shape for an edge end. `none` = no marker.
 * Legacy saves stored a boolean (`true` = filled arrow) — coerced via
 * `normalizeMarker` in utils/edgeMarkers.
 */
export type MarkerShape = 'none' | 'arrow' | 'arrow-open' | 'circle' | 'diamond' | 'square'

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
  /** Marker shape at the source end. Legacy boolean (`true`=arrow) coerced on read. */
  marker_start?: MarkerShape | boolean
  /** Marker shape at the target end. Legacy boolean (`true`=arrow) coerced on read. */
  marker_end?: MarkerShape | boolean
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
  laptop: 'Laptop',
  mobile: 'Phone / Mobile',
  cpl: 'CPL / Powerline',
  docker_host: 'Docker Host',
  docker_container: 'Docker Container',
  generic: 'Generic Device',
  groupRect: 'Group Rectangle',
  group: 'Node Group',
  text: 'Text',
  zigbee_coordinator: 'Zigbee Coordinator',
  zigbee_router: 'Zigbee Router',
  zigbee_enddevice: 'Zigbee End Device',
  zwave_coordinator: 'Z-Wave Controller',
  zwave_router: 'Z-Wave Router',
  zwave_enddevice: 'Z-Wave End Device',
  grid: 'Grid Connection',
  ups: 'UPS',
  battery: 'Battery',
  generator: 'Generator',
  solar_panel: 'Solar Panel',
  inverter: 'Inverter',
  circuit_breaker: 'Circuit Breaker',
  contactor: 'Contactor',
  electrical_switch: 'Switch',
  socket: 'Socket / Outlet',
  light: 'Light Fixture',
  meter: 'Energy Meter',
  transformer: 'Transformer',
  load: 'Electrical Load',
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
  fibre: 'Fibre',
  electrical: 'Electrical Wire',
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
  /** Default connection-point counts per side for new nodes of this type. */
  topHandles?: number
  bottomHandles?: number
  leftHandles?: number
  rightHandles?: number
}

export interface EdgeTypeStyle {
  color: string
  opacity: number
  pathStyle: EdgePathStyle
  animated: 'none' | 'snake' | 'flow' | 'basic'
  /** Default marker shape at the source end for new edges of this type. */
  arrowStart: MarkerShape
  /** Default marker shape at the target end for new edges of this type. */
  arrowEnd: MarkerShape
}

export interface CustomStyleDef {
  nodes: Partial<Record<NodeType, NodeTypeStyle>>
  edges: Partial<Record<EdgeType, EdgeTypeStyle>>
}

export interface FloorMapConfig {
  /**
   * Server URL of the uploaded image (e.g. /api/v1/media/<uuid>.png).
   * Legacy canvases may still hold a base64 `data:` URL — both render in <img>.
   * Floor plans require a backend; they are disabled in standalone mode.
   */
  imageData: string
  posX: number
  posY: number
  width: number
  height: number
  opacity: number
  locked: boolean
  enabled: boolean
}

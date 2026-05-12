/** Shared Zigbee type definitions for the frontend. */

export interface ZigbeeNode {
  id: string
  label: string
  type: 'zigbee_coordinator' | 'zigbee_router' | 'zigbee_enddevice'
  ieee_address: string
  friendly_name: string
  device_type: string
  model?: string | null
  vendor?: string | null
  lqi?: number | null
  parent_id?: string | null
}

export interface ZigbeeEdge {
  source: string
  target: string
}

export interface ZigbeeImportResponse {
  nodes: ZigbeeNode[]
  edges: ZigbeeEdge[]
  device_count: number
}

export interface ZigbeeTestConnectionRequest {
  mqtt_host: string
  mqtt_port: number
  mqtt_username?: string
  mqtt_password?: string
}

export interface ZigbeeTestConnectionResponse {
  connected: boolean
  message: string
}

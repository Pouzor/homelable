/** Shared Z-Wave type definitions for the frontend. */

export interface ZwaveNode {
  id: string
  label: string
  type: 'zwave_coordinator' | 'zwave_router' | 'zwave_enddevice'
  ieee_address: string
  friendly_name: string
  device_type: string
  model?: string | null
  vendor?: string | null
  lqi?: number | null
  parent_id?: string | null
}

export interface ZwaveEdge {
  source: string
  target: string
}

export interface ZwaveImportResponse {
  nodes: ZwaveNode[]
  edges: ZwaveEdge[]
  device_count: number
}

export interface ZwaveTestConnectionRequest {
  mqtt_host: string
  mqtt_port: number
  mqtt_username?: string
  mqtt_password?: string
}

export interface ZwaveTestConnectionResponse {
  connected: boolean
  message: string
}

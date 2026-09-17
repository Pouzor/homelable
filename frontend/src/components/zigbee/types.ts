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
  /** Device Inventory row this node draws — stamped by the import so the
   * canvas save links to it instead of minting a second row. */
  device_id?: string | null
}

export interface ZigbeeEdge {
  source: string
  target: string
  /** Link quality measured for this link, when the map reported one. */
  lqi?: number | null
  /** `tree` = parent attachment (always imported); `mesh` = neighbour link,
   *  only present when the import opted into mesh links. */
  kind?: 'tree' | 'mesh'
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

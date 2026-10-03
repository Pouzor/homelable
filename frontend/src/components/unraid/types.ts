/** Shared Unraid import type definitions for the frontend. */

export type UnraidNodeType = 'docker_host' | 'docker_container'

export interface UnraidNode {
  id: string
  label: string
  type: UnraidNodeType
  ieee_address: string
  hostname?: string | null
  ip?: string | null
  status: string
  vendor?: string | null
  /** Image for a container, board maker + model for the host. */
  model?: string | null
  parent_ieee?: string | null
  /** Device Inventory row this node draws - stamped by the import so the
   * canvas save links to it instead of minting a second row. */
  device_id?: string | null
}

export interface UnraidEdge {
  source: string
  target: string
}

export interface UnraidImportResponse {
  nodes: UnraidNode[]
  edges: UnraidEdge[]
  device_count: number
}

/** Shared Synology DSM import type definitions for the frontend. */

export type SynologyNodeType = 'nas' | 'docker_container'

export interface SynologyNode {
  id: string
  label: string
  type: SynologyNodeType
  ieee_address: string
  hostname?: string | null
  ip?: string | null
  mac?: string | null
  status: string
  ram_gb?: number | null
  disk_gb?: number | null
  vendor?: string | null
  model?: string | null
  parent_ieee?: string | null
  image?: string | null
  ports?: string | null
}

export interface SynologyEdge {
  source: string
  target: string
}

export interface SynologyImportResponse {
  nodes: SynologyNode[]
  edges: SynologyEdge[]
  device_count: number
}

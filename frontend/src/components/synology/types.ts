/** Shared Synology DSM import type definitions for the frontend. */

export interface SynologyNode {
  id: string
  label: string
  type: 'nas'
  ieee_address: string
  hostname?: string | null
  ip?: string | null
  mac?: string | null
  status: string
  ram_gb?: number | null
  disk_gb?: number | null
  vendor?: string | null
  model?: string | null
}

export interface SynologyImportResponse {
  nodes: SynologyNode[]
  device_count: number
}

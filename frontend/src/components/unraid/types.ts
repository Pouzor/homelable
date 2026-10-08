/** Shared Unraid import type definitions for the frontend. */

import type { NodeProperty, ServiceInfo } from '@/types'

export type UnraidNodeType = 'docker_host' | 'docker_container' | 'vm'

export interface UnraidNode {
  id: string
  label: string
  type: UnraidNodeType
  ieee_address: string
  hostname?: string | null
  ip?: string | null
  status: string
  vendor?: string | null
  /** Image for a container, board maker + model for the host, KVM for a VM. */
  model?: string | null
  parent_ieee?: string | null
  /** Device Inventory row this node draws - stamped by the import so the
   * canvas save links to it instead of minting a second row. */
  device_id?: string | null
  /** The inventory row's lists - a container's web UI is one of the services. */
  services?: ServiceInfo[]
  properties?: NodeProperty[]
}

export interface UnraidEdge {
  source: string
  target: string
}

export interface UnraidImportResponse {
  nodes: UnraidNode[]
  edges: UnraidEdge[]
  device_count: number
  /** Why VMs were left out (e.g. the API key has no VM access). */
  notice?: string | null
}

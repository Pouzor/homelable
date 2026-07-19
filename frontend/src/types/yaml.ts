import type { NodeType, EdgeType, CheckMethod } from '@/types'

export interface YamlNodeConnection {
  label: string
  linkType?: EdgeType
  linkLabel?: string
  // Connection points (React Flow handle IDs) the edge attaches to. Preserved so
  // a manual layout round-trips instead of collapsing every edge onto slot 0.
  sourceHandle?: string
  targetHandle?: string
}

export interface YamlNode {
  nodeType: NodeType
  nodeIcon?: string
  label: string
  hostname?: string
  ipAddress?: string
  checkMethod?: CheckMethod
  checkTarget?: string
  notes?: string
  links?: YamlNodeConnection[]
  parent?: YamlNodeConnection
  clusterR?: YamlNodeConnection
  clusterL?: YamlNodeConnection
  cpuModel?: string
  cpuCore?: number
  ram?: number
  disk?: number
  // Per-side connection-point counts. Only written when a side has more than its
  // default (top/bottom 1, left/right 0) so the referenced handle slot exists on
  // re-import — without it React Flow falls back to slot 0.
  topHandles?: number
  bottomHandles?: number
  leftHandles?: number
  rightHandles?: number
  // Whether port-number labels are shown next to connection points. Only written
  // when enabled so the toggle round-trips through export/import (issue #272).
  showPortNumbers?: boolean
}

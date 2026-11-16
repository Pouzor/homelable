import type { NodeType, EdgeType, CheckMethod, NodeData } from '@/types'

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
  // The device's own numbering per connection point, keyed by handle ID — only
  // written when at least one point carries a label (#495).
  portLabels?: Record<string, string>
  // The node's key/value properties (#608). `icon` is omitted when unset and
  // `visible` when true, so the common case stays a two-line entry.
  properties?: YamlNodeProperty[]
  // The node's appearance overrides — `custom_colors` minus the legacy zone
  // geometry (zones are not exported). Keys keep the canvas spelling.
  nodeStyle?: Omit<NonNullable<NodeData['custom_colors']>, 'width' | 'height'>
}

export interface YamlNodeProperty {
  key: string
  value: string
  icon?: string
  visible?: boolean
}

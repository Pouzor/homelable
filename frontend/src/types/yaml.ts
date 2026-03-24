import type { NodeType, EdgeType, CheckMethod } from '@/types'

export interface YamlNodeConnection {
  label: string
  linkType?: EdgeType
  linkLabel?: string
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
  parent?: YamlNodeConnection
  clusterR?: YamlNodeConnection
  clusterL?: YamlNodeConnection
  cpuModel?: string
  cpuCore?: number
  ram?: number
  disk?: number
}

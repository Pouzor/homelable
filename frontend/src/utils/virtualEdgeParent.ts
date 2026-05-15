import type { NodeData } from '@/types'

export type NodeType = NodeData['type']

const CONTAINER_MODE_TYPES = new Set<NodeType>(['proxmox', 'vm', 'lxc', 'docker_host'])

export interface VirtualEdgeEndpoint {
  id: string
  type: NodeType
}

export interface ParentAssignment {
  childId: string
  parentId: string
}

export function resolveVirtualEdgeParent(
  source: VirtualEdgeEndpoint,
  target: VirtualEdgeEndpoint,
): ParentAssignment | null {
  const { type: srcType, id: srcId } = source
  const { type: tgtType, id: tgtId } = target

  if ((srcType === 'lxc' || srcType === 'vm') && CONTAINER_MODE_TYPES.has(tgtType)) {
    return { childId: srcId, parentId: tgtId }
  }
  if (CONTAINER_MODE_TYPES.has(srcType) && (tgtType === 'lxc' || tgtType === 'vm')) {
    return { childId: tgtId, parentId: srcId }
  }
  if (srcType === 'docker_container' && (tgtType === 'docker_host' || tgtType === 'lxc')) {
    return { childId: srcId, parentId: tgtId }
  }
  if (tgtType === 'docker_container' && (srcType === 'docker_host' || srcType === 'lxc')) {
    return { childId: tgtId, parentId: srcId }
  }
  return null
}

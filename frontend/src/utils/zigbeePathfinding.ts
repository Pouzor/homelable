import type { Node, Edge } from '@xyflow/react'
import type { NodeData, EdgeData } from '@/types'

function getNodeLqi(node: Node<NodeData>): number {
  const lqiProp = node.data.properties?.find((p) => p.key === 'LQI')
  if (!lqiProp) return 255
  const lqi = parseInt(lqiProp.value, 10)
  return isNaN(lqi) ? 255 : lqi
}

/**
 * Run Dijkstra on the Zigbee `iot` edge subgraph from `startNodeId` to
 * `targetNodeId`. Returns the ordered list of edge IDs forming the optimal
 * path, or an empty array if no path exists.
 *
 * Edge cost = 255 - LQI, where LQI is read from the edge's target node
 * properties (higher LQI = lower cost). For reverse traversal, the same
 * cost is used.
 */
export function findZigbeePath(
  startNodeId: string,
  targetNodeId: string,
  nodes: Node<NodeData>[],
  edges: Edge<EdgeData>[],
): string[] {
  if (startNodeId === targetNodeId) return []

  const iotEdges = edges.filter((e) => (e.data?.type ?? 'ethernet') === 'iot')
  if (iotEdges.length === 0) return []

  const nodeMap = new Map(nodes.map((n) => [n.id, n]))
  const adjacency = new Map<string, { neighbor: string; edgeId: string; cost: number }[]>()

  for (const e of iotEdges) {
    const targetLqi = nodeMap.get(e.target) ? getNodeLqi(nodeMap.get(e.target)!) : 255
    const sourceLqi = nodeMap.get(e.source) ? getNodeLqi(nodeMap.get(e.source)!) : 255
    const cost = 255 - Math.min(targetLqi, sourceLqi)

    if (!adjacency.has(e.source)) adjacency.set(e.source, [])
    if (!adjacency.has(e.target)) adjacency.set(e.target, [])

    adjacency.get(e.source)!.push({ neighbor: e.target, edgeId: e.id, cost })
    adjacency.get(e.target)!.push({ neighbor: e.source, edgeId: e.id, cost })
  }

  if (!adjacency.has(startNodeId) || !adjacency.has(targetNodeId)) return []

  const dist = new Map<string, number>()
  const prev = new Map<string, { node: string; edgeId: string }>()
  const unvisited = new Set(adjacency.keys())

  for (const nodeId of unvisited) dist.set(nodeId, Infinity)
  dist.set(startNodeId, 0)

  while (unvisited.size > 0) {
    let current: string | null = null
    let minDist = Infinity
    for (const nodeId of unvisited) {
      const d = dist.get(nodeId)!
      if (d < minDist) { minDist = d; current = nodeId }
    }
    if (current === null || minDist === Infinity) break
    if (current === targetNodeId) break

    unvisited.delete(current)

    const neighbors = adjacency.get(current) ?? []
    for (const { neighbor, edgeId, cost } of neighbors) {
      if (!unvisited.has(neighbor)) continue
      const alt = dist.get(current)! + cost
      if (alt < (dist.get(neighbor) ?? Infinity)) {
        dist.set(neighbor, alt)
        prev.set(neighbor, { node: current, edgeId })
      }
    }
  }

  // Reconstruct path: walk from targetNodeId back to startNodeId
  const pathEdges: string[] = []
  let current = targetNodeId
  while (current !== startNodeId) {
    const p = prev.get(current)
    if (!p) return []
    pathEdges.unshift(p.edgeId)
    current = p.node
  }

  return pathEdges
}

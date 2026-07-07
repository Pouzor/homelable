/** Apply server-created "auto" edges (from scan/import approve) to the canvas.
 *
 * The approve endpoints create edges server-side and return them with their
 * type + handle IDs. We must inject them faithfully: a Proxmox cluster edge
 * keeps its right→left handles, mesh links stay iot bottom→top. Left/right
 * handles default to 0, so a node referenced on its left/right side must be
 * granted that side's connection point or the edge endpoint won't exist and
 * React Flow falls back to the top handle.
 */
import type { Edge, Node } from '@xyflow/react'
import type { EdgeData, EdgeType, NodeData } from '@/types'
import { normalizeHandle, handleCountField, type Side } from '@/utils/handleUtils'

export interface AutoEdge {
  id: string
  source: string
  target: string
  type?: string
  source_handle?: string | null
  target_handle?: string | null
}

/** Side a handle id sits on ('left-t' → 'left', 'bottom-2' → 'bottom'). */
export function handleSide(h: string | null | undefined): Side | null {
  const bare = normalizeHandle(h)
  const m = bare?.match(/^(top|bottom|left|right)/)
  return m ? (m[1] as Side) : null
}

/**
 * Pure transform: given current nodes + edges and the server auto-edges,
 * return the next nodes (with left/right handle counts bumped where an edge
 * needs them) and edges (with the injected edges appended).
 */
export function applyAutoEdges(
  nodes: Node<NodeData>[],
  edges: Edge<EdgeData>[],
  autoEdges: AutoEdge[],
): { nodes: Node<NodeData>[]; edges: Edge<EdgeData>[] } {
  // node id → left/right sides that need at least one handle.
  const bumps = new Map<string, Set<Side>>()
  const mark = (id: string, side: Side | null) => {
    if (!side || side === 'top' || side === 'bottom') return // always exist
    const set = bumps.get(id) ?? new Set<Side>()
    set.add(side)
    bumps.set(id, set)
  }

  const injected: Edge<EdgeData>[] = autoEdges.map((e) => {
    const type = (e.type ?? 'iot') as EdgeType
    const sourceHandle = e.source_handle ?? 'bottom'
    const targetHandle = e.target_handle ?? 'top'
    mark(e.source, handleSide(sourceHandle))
    mark(e.target, handleSide(targetHandle))
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle,
      targetHandle,
      type,
      data: { type } as EdgeData,
    }
  })

  const nextNodes = bumps.size === 0 ? nodes : nodes.map((n) => {
    const sides = bumps.get(n.id)
    if (!sides) return n
    const data = { ...n.data }
    for (const side of sides) {
      const field = handleCountField(side)
      data[field] = Math.max((data[field] as number | undefined) ?? 0, 1)
    }
    return { ...n, data }
  })

  return { nodes: nextNodes, edges: [...edges, ...injected] }
}

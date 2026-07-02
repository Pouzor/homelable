import type { Edge, Node } from '@xyflow/react'
import type { EdgeData, NodeData } from '@/types'

/**
 * Collapse model
 * ──────────────
 * Two ways a node can collapse and hide what it "contains":
 *
 *   1. parentId hierarchy  — `type: 'group'` containers (createGroup) and
 *      Proxmox container_mode children. Setting `data.collapsed = true` on
 *      such a node hides every node in its parentId subtree.
 *
 *   2. Spatial containment — `type: 'groupRect'` decorative zones drawn
 *      around nodes. Zones do not parent their contents in React Flow, so
 *      we hit-test every top-level node's centre against the zone bbox to
 *      decide what is "inside". Collapsing a zone hides every node whose
 *      centre lies inside the zone (plus the parentId subtrees of those
 *      nodes, so e.g. a Proxmox host inside a collapsed zone also takes its
 *      VMs/LXCs with it).
 *
 * `hiddenBy` records which collapsed ancestor hid each node — used by edge
 * rewiring to redirect a vanished endpoint to the visible zone the user is
 * actually looking at.
 */

interface BBox { x: number; y: number; w: number; h: number }

const DEFAULT_NODE_W = 200
const DEFAULT_NODE_H = 80
const DEFAULT_ZONE_W = 360
const DEFAULT_ZONE_H = 240

function bboxOf(n: Node<NodeData>, fallbackW: number, fallbackH: number): BBox {
  return {
    x: n.position.x,
    y: n.position.y,
    w: n.width ?? fallbackW,
    h: n.height ?? fallbackH,
  }
}

function centerInside(n: Node<NodeData>, b: BBox): boolean {
  const w = n.width ?? DEFAULT_NODE_W
  const h = n.height ?? DEFAULT_NODE_H
  const cx = n.position.x + w / 2
  const cy = n.position.y + h / 2
  return cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h
}

/**
 * Node ids whose centre lies inside the given zone, excluding the zone
 * itself and any node that is a React Flow child (parentId set — those are
 * positioned relative to their parent, not in absolute canvas coordinates).
 */
export function getZoneSpatialChildren(
  zone: Node<NodeData>,
  nodes: Node<NodeData>[],
): string[] {
  const zb = bboxOf(zone, DEFAULT_ZONE_W, DEFAULT_ZONE_H)
  const out: string[] = []
  for (const n of nodes) {
    if (n.id === zone.id) continue
    if (n.parentId) continue
    if (centerInside(n, zb)) out.push(n.id)
  }
  return out
}

function buildChildrenByParent(nodes: Node<NodeData>[]): Map<string, string[]> {
  const m = new Map<string, string[]>()
  for (const n of nodes) {
    if (!n.parentId) continue
    const arr = m.get(n.parentId)
    if (arr) arr.push(n.id)
    else m.set(n.parentId, [n.id])
  }
  return m
}

export interface CollapseInfo {
  /** Ids the canvas should render. */
  visibleIds: Set<string>
  /** For each hidden id, the id of the collapsed ancestor that hid it. */
  hiddenBy: Map<string, string>
}

/**
 * Single source of truth for visibility under collapse. O(n) over nodes
 * (the spatial pass is O(z·n) where z is the number of collapsed zones).
 */
export function computeCollapseInfo(nodes: Node<NodeData>[]): CollapseInfo {
  const childrenByParent = buildChildrenByParent(nodes)
  const hidden = new Set<string>()
  const hiddenBy = new Map<string, string>()

  const hideSubtree = (rootId: string, hider: string) => {
    const queue = [...(childrenByParent.get(rootId) ?? [])]
    while (queue.length > 0) {
      const id = queue.shift()!
      if (hidden.has(id)) continue
      hidden.add(id)
      if (!hiddenBy.has(id)) hiddenBy.set(id, hider)
      const sub = childrenByParent.get(id)
      if (sub) queue.push(...sub)
    }
  }

  // Pass 1 — parentId-based collapse (real containers).
  for (const n of nodes) {
    if (n.data.collapsed) hideSubtree(n.id, n.id)
  }

  // Pass 2 — spatial collapse (groupRect zones).
  for (const n of nodes) {
    if (n.data.type !== 'groupRect') continue
    if (!n.data.collapsed) continue
    const contained = getZoneSpatialChildren(n, nodes)
    for (const id of contained) {
      if (!hidden.has(id)) {
        hidden.add(id)
        if (!hiddenBy.has(id)) hiddenBy.set(id, n.id)
      }
      hideSubtree(id, n.id)
    }
  }

  const visibleIds = new Set<string>()
  for (const n of nodes) {
    if (!hidden.has(n.id)) visibleIds.add(n.id)
  }
  return { visibleIds, hiddenBy }
}

/**
 * Convenience wrapper kept for call sites that only need the visible set.
 */
export function getVisibleNodeIds(nodes: Node<NodeData>[]): Set<string> {
  return computeCollapseInfo(nodes).visibleIds
}

/**
 * Rewire edges so that any endpoint inside a collapsed subtree (parentId or
 * spatial) is replaced with the nearest visible ancestor. See module
 * docstring for the full rationale.
 *
 *  - Both endpoints visible            → edge kept as-is.
 *  - One endpoint hidden                → endpoint replaced by its nearest
 *                                         visible ancestor; edge surfaces
 *                                         as a stub on the collapsed zone.
 *  - Both endpoints hidden under the
 *    same visible ancestor              → dropped (would be a self-loop).
 *  - Parallel rewires to the same pair  → de-duplicated; one stub kept.
 *    (Prevents a 20-device mesh from rendering 20 stacked stubs.)
 *  - Endpoint with no visible ancestor  → dropped.
 */
export function rewireEdgesForCollapse(
  edges: Edge<EdgeData>[],
  nodes: Node<NodeData>[],
  visibleIds: Set<string>,
  hiddenBy?: Map<string, string>,
): Edge<EdgeData>[] {
  // If the caller already computed hiddenBy (CanvasContainer path), reuse
  // it. Otherwise recompute — keeps the helper callable from tests without
  // forcing them to thread the second map through.
  const hb = hiddenBy ?? computeCollapseInfo(nodes).hiddenBy

  const nearestVisible = (id: string): string | null => {
    let cur: string | undefined = id
    const guard = new Set<string>()
    while (cur !== undefined) {
      if (visibleIds.has(cur)) return cur
      if (guard.has(cur)) return null
      guard.add(cur)
      cur = hb.get(cur)
    }
    return null
  }

  const seen = new Set<string>()
  const out: Edge<EdgeData>[] = []
  for (const e of edges) {
    const src = nearestVisible(e.source)
    const tgt = nearestVisible(e.target)
    if (src === null || tgt === null) continue
    if (src === tgt) continue
    const key = `${src}->${tgt}`
    if (seen.has(key)) continue
    seen.add(key)
    if (src === e.source && tgt === e.target) {
      out.push(e)
    } else {
      out.push({ ...e, source: src, target: tgt, sourceHandle: null, targetHandle: null })
    }
  }
  return out
}

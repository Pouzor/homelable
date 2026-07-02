import dagre from '@dagrejs/dagre'
import type { Node, Edge } from '@xyflow/react'
import type { NodeData, EdgeData } from '@/types'
import { normalizeHandle } from '@/utils/handleUtils'

const NODE_WIDTH = 180
const NODE_HEIGHT = 52

const PEER_TYPES = new Set(['proxmox', 'switch'])

/**
 * Port index encoded by a bottom source handle:
 *   'bottom' → 0, 'bottom-2' → 1, 'bottom-3' → 2, ...
 * Anything else (top handle, null, unknown) sorts last.
 */
function handlePortIndex(handle: string | null | undefined): number {
  const h = normalizeHandle(handle)
  if (!h || h === 'top') return Number.MAX_SAFE_INTEGER
  if (h === 'bottom') return 0
  const m = h.match(/^bottom-(\d+)$/)
  return m ? Number(m[1]) - 1 : Number.MAX_SAFE_INTEGER
}

/**
 * Find groups of peer nodes (same type, directly connected to each other)
 * using union-find. Returns a map: nodeId → groupId (the minimum nodeId in the group).
 */
function buildPeerGroups(
  topLevel: Node<NodeData>[],
  edges: Edge<EdgeData>[],
): Map<string, string> {
  const parent = new Map<string, string>(topLevel.map((n) => [n.id, n.id]))

  function find(id: string): string {
    if (parent.get(id) !== id) parent.set(id, find(parent.get(id)!))
    return parent.get(id)!
  }
  function union(a: string, b: string) {
    const ra = find(a), rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }

  const topLevelIds = new Set(topLevel.map((n) => n.id))
  const peerIds = new Set(topLevel.filter((n) => PEER_TYPES.has(n.type ?? '')).map((n) => n.id))

  for (const edge of edges) {
    const { source: s, target: t } = edge
    if (topLevelIds.has(s) && topLevelIds.has(t) && peerIds.has(s) && peerIds.has(t)) {
      // Only merge if both nodes share the same type (proxmox↔proxmox, switch↔switch)
      const srcNode = topLevel.find((n) => n.id === s)!
      const tgtNode = topLevel.find((n) => n.id === t)!
      if (srcNode.type === tgtNode.type) union(s, t)
    }
  }

  // Resolve all to canonical group ids
  const result = new Map<string, string>()
  for (const n of topLevel) result.set(n.id, find(n.id))
  return result
}

/**
 * Apply Dagre hierarchical (top-to-bottom) layout to nodes and edges.
 * Child nodes (parentId set) keep their relative position inside the parent — only
 * top-level nodes are repositioned by Dagre.
 *
 * Post-pass: peer nodes of the same type (proxmox, switch) connected to each other
 * are snapped to the same Y rank so they appear on the same horizontal level.
 */
export function applyDagreLayout(
  nodes: Node<NodeData>[],
  edges: Edge<EdgeData>[],
): Node<NodeData>[] {
  const topLevel = nodes.filter((n) => !n.parentId)
  const topLevelIds = new Set(topLevel.map((n) => n.id))

  // Capture original X positions before Dagre — used to preserve left-to-right
  // ordering of peer groups as the user set them.
  const originalX = new Map<string, number>(topLevel.map((n) => [n.id, n.position.x]))

  // Identify peer groups before running Dagre so we can exclude peer edges
  const peerGroups = buildPeerGroups(topLevel, edges)
  const isPeerEdge = (e: Edge<EdgeData>) => {
    const sg = peerGroups.get(e.source)
    const tg = peerGroups.get(e.target)
    return sg !== undefined && tg !== undefined && sg === tg
  }

  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'TB', nodesep: 60, ranksep: 80 })

  for (const node of topLevel) {
    const w = node.type === 'proxmox' ? (node.width ?? 300) : NODE_WIDTH
    const h = node.type === 'proxmox' ? (node.height ?? 200) : NODE_HEIGHT
    g.setNode(node.id, { width: w, height: h })
  }
  for (const edge of edges) {
    const srcTop = topLevelIds.has(edge.source)
    const tgtTop = topLevelIds.has(edge.target)
    // Exclude peer-to-peer edges — they confuse Dagre's rank assignment
    if (!srcTop || !tgtTop || isPeerEdge(edge)) continue
    // If the edge exits from the TOP handle of the source, the connection goes
    // upward — meaning the source node is visually below the target. Reverse
    // the edge direction for Dagre so it places the source below the target.
    const upward = (edge as { sourceHandle?: string | null }).sourceHandle === 'top'
    if (upward) {
      g.setEdge(edge.target, edge.source)
    } else {
      g.setEdge(edge.source, edge.target)
    }
  }

  dagre.layout(g)

  // Build initial positions from Dagre
  const positions = new Map<string, { x: number; y: number; w: number; h: number }>()
  for (const node of topLevel) {
    const pos = g.node(node.id)
    const w = node.type === 'proxmox' ? (node.width ?? 300) : NODE_WIDTH
    const h = node.type === 'proxmox' ? (node.height ?? 200) : NODE_HEIGHT
    positions.set(node.id, { x: pos.x - w / 2, y: pos.y - h / 2, w, h })
  }

  // Post-pass: fix peer groups (same-type nodes directly connected to each other)
  // Collect members per group
  const groupMembers = new Map<string, string[]>()
  for (const [id, groupId] of peerGroups) {
    if (!groupMembers.has(groupId)) groupMembers.set(groupId, [])
    groupMembers.get(groupId)!.push(id)
  }

  for (const [, members] of groupMembers) {
    if (members.length < 2) continue

    // --- Y: snap all to average Y of the group ---
    const avgY = members.reduce((sum, id) => sum + positions.get(id)!.y, 0) / members.length
    for (const id of members) positions.set(id, { ...positions.get(id)!, y: avgY })

    // --- X: sort by original (pre-layout) X to preserve the user's intended
    //         left-to-right order. Fall back to Dagre X if all nodes share the
    //         same original X (e.g. freshly created canvas with no positions yet). ---
    const GAP = 60
    const origXs = members.map((id) => originalX.get(id) ?? 0)
    const allSameOrigX = origXs.every((x) => x === origXs[0])
    const ordered = members.slice().sort((a, b) =>
      allSameOrigX
        ? positions.get(a)!.x - positions.get(b)!.x   // fall back to Dagre X
        : (originalX.get(a) ?? 0) - (originalX.get(b) ?? 0), // preserve user order
    )
    const totalWidth = ordered.reduce((sum, id) => sum + positions.get(id)!.w, 0) + GAP * (ordered.length - 1)
    const centerX = members.reduce((sum, id) => sum + positions.get(id)!.x + positions.get(id)!.w / 2, 0) / members.length

    let curX = centerX - totalWidth / 2
    for (const id of ordered) {
      const p = positions.get(id)!
      positions.set(id, { ...p, x: curX })
      curX += p.w + GAP
    }
  }

  // Post-pass: reorder direct children left-to-right so their horizontal order
  // matches the parent's bottom-port order. Dagre's ordering heuristic ignores
  // handle ids and frequently flips siblings relative to the port they plug
  // into on the host. We keep Dagre's X *slots* but reassign which child sits in
  // each slot, then shift each child's whole subtree by the same delta so nested
  // nodes follow their parent.
  reorderChildrenByPort(topLevel, edges, positions, peerGroups, isPeerEdge)

  return nodes.map((node) => {
    if (node.parentId) return node
    const p = positions.get(node.id)!
    return { ...node, position: { x: p.x, y: p.y } }
  })
}

type Pos = { x: number; y: number; w: number; h: number }

function reorderChildrenByPort(
  topLevel: Node<NodeData>[],
  edges: Edge<EdgeData>[],
  positions: Map<string, Pos>,
  peerGroups: Map<string, string>,
  isPeerEdge: (e: Edge<EdgeData>) => boolean,
): void {
  const topLevelIds = new Set(topLevel.map((n) => n.id))

  // Peer groups own their own X layout; skip nodes in a multi-member group so
  // we don't fight the peer post-pass.
  const peerGroupSize = new Map<string, number>()
  for (const gid of peerGroups.values()) peerGroupSize.set(gid, (peerGroupSize.get(gid) ?? 0) + 1)
  const inPeerGroup = (id: string) => (peerGroupSize.get(peerGroups.get(id) ?? '') ?? 0) > 1

  // Build parent → children (with the port used on the parent) and a downward
  // adjacency for subtree shifting. "Parent" = the visually upper node (smaller Y).
  const childrenOf = new Map<string, { child: string; port: number }[]>()
  const downAdj = new Map<string, string[]>()
  for (const e of edges) {
    if (!topLevelIds.has(e.source) || !topLevelIds.has(e.target) || isPeerEdge(e)) continue
    const ps = positions.get(e.source)!
    const pt = positions.get(e.target)!
    if (ps.y === pt.y) continue // same rank — not a parent/child relationship
    const sourceIsUpper = ps.y < pt.y
    const parent = sourceIsUpper ? e.source : e.target
    const child = sourceIsUpper ? e.target : e.source
    // Port is read from the handle on the parent (upper) node.
    const handle = sourceIsUpper ? e.sourceHandle : e.targetHandle
    if (!childrenOf.has(parent)) childrenOf.set(parent, [])
    childrenOf.get(parent)!.push({ child, port: handlePortIndex(handle) })
    if (!downAdj.has(parent)) downAdj.set(parent, [])
    downAdj.get(parent)!.push(child)
  }

  const shiftSubtree = (rootId: string, dx: number) => {
    const seen = new Set<string>()
    const stack = [rootId]
    while (stack.length) {
      const id = stack.pop()!
      if (seen.has(id)) continue
      seen.add(id)
      const p = positions.get(id)
      if (p) positions.set(id, { ...p, x: p.x + dx })
      for (const next of downAdj.get(id) ?? []) if (!seen.has(next)) stack.push(next)
    }
  }

  for (const [, rawKids] of childrenOf) {
    // De-dup (a child may share several edges with the parent) and drop peers.
    const seen = new Set<string>()
    const kids = rawKids.filter((k) => {
      if (seen.has(k.child) || inPeerGroup(k.child)) return false
      seen.add(k.child)
      return true
    })
    if (kids.length < 2) continue

    // The X centre slots Dagre produced, sorted left-to-right.
    const centerOf = (id: string) => positions.get(id)!.x + positions.get(id)!.w / 2
    const slots = kids.map((k) => centerOf(k.child)).sort((a, b) => a - b)

    // Desired order: by port, then current X (stable for equal/unknown ports).
    const ordered = kids.slice().sort((a, b) => a.port - b.port || centerOf(a.child) - centerOf(b.child))

    ordered.forEach((k, i) => {
      const delta = slots[i] - centerOf(k.child)
      if (delta !== 0) shiftSubtree(k.child, delta)
    })
  }
}

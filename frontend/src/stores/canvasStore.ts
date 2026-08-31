import { create } from 'zustand'
import {
  type Node,
  type Edge,
  type NodeChange,
  type NodePositionChange,
  type EdgeChange,
  type Connection,
  applyNodeChanges,
  applyEdgeChanges,
} from '@xyflow/react'
import type { NodeData, EdgeData, NodeType, EdgeType, NodeTypeStyle, EdgeTypeStyle, CustomStyleDef, ServiceStatus, FloorMapConfig } from '@/types'
import { generateUUID } from '@/utils/uuid'
import { normalizeHandle, removedHandleIds, handleCountField, sideDefault, handleId, SIDES } from '@/utils/handleUtils'
import { applyOpacity } from '@/utils/colorUtils'
import { readHideIp, writeHideIp } from '@/utils/ipDisplay'
import { isValidCidr, isZoneSubnetCandidate } from '@/utils/subnet'
import { CONTAINER_MODE_TYPES } from '@/utils/virtualEdgeParent'
import {
  changedFactFields,
  factsBaselineOf,
  factsBaselines,
  listArrangedForNode,
  type FactsBaseline,
} from '@/utils/deviceFacts'

type HistoryEntry = { nodes: Node<NodeData>[]; edges: Edge<EdgeData>[] }
type Clipboard = { nodes: Node<NodeData>[]; edges: Edge<EdgeData>[] }

/** Resolve a node's effective parent id from either the RF field or domain data. */
const parentIdOf = (n: Node<NodeData>): string | undefined => n.parentId ?? n.data.parent_id ?? undefined

/**
 * Reorder so every node follows its parent, which is what React Flow needs to
 * resolve nesting — a child listed first renders detached and logs a
 * parent-not-found error. Order is otherwise preserved: a list that is already
 * valid comes back untouched. A parent cycle terminates instead of recursing.
 */
function orderParentsFirst(nodes: Node<NodeData>[]): Node<NodeData>[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const emitted = new Set<string>()
  const visiting = new Set<string>()
  const out: Node<NodeData>[] = []

  const visit = (n: Node<NodeData>) => {
    if (emitted.has(n.id) || visiting.has(n.id)) return
    visiting.add(n.id)
    const parent = n.parentId ? byId.get(n.parentId) : undefined
    if (parent) visit(parent)
    visiting.delete(n.id)
    emitted.add(n.id)
    out.push(n)
  }

  for (const n of nodes) visit(n)
  return out
}

// Zone subnet import: the grid the arrivals are packed on, in zone-relative
// pixels. A cell is one node box plus the gap that follows it.
const DEFAULT_ZONE_WIDTH = 360
const DEFAULT_ZONE_HEIGHT = 240
const ZONE_CELL_W = 180
const ZONE_CELL_H = 110
const ZONE_CELL_GAP = 20
const ZONE_PAD_X = 32
// Leaves the label band at the top of the zone clear.
const ZONE_PAD_TOP = 40
const ZONE_PAD_BOTTOM = 16

/**
 * Whether a node change represents a real user edit that should dirty the canvas.
 * Excludes:
 *  - 'select': selecting a node changes nothing persisted.
 *  - 'dimensions' without resizing: React Flow emits these when it first measures
 *    a node's size after mount/load. Counting them as edits marks a freshly
 *    loaded canvas dirty before the user touches anything (autosave would then
 *    save on every load). A user-driven resize sets `resizing === true` and still
 *    dirties.
 */
function isUserNodeEdit(c: NodeChange<Node<NodeData>>): boolean {
  if (c.type === 'select') return false
  if (c.type === 'dimensions' && c.resizing !== true) return false
  return true
}

/**
 * Keep manually-routed edge waypoints attached to their nodes on drag (#279).
 *
 * Waypoints live in absolute canvas coords, so they don't move when a connected
 * node is dragged. For every node that moved on screen we translate the
 * waypoints of edges touching it by the same delta. A dragged container moves
 * its children on screen too — their stored (parent-relative) position is
 * unchanged, so we propagate the container's delta down to every descendant.
 */
function translateWaypointsForMovedNodes(
  changes: NodeChange<Node<NodeData>>[],
  prevNodes: Node<NodeData>[],
  nextNodes: Node<NodeData>[],
  edges: Edge<EdgeData>[],
): Edge<EdgeData>[] {
  const positionChanges = changes.filter(
    (c): c is NodePositionChange => c.type === 'position' && !!c.position,
  )
  if (positionChanges.length === 0) return edges

  const prevById = new Map(prevNodes.map((n) => [n.id, n]))
  // node id -> absolute screen delta it moved by
  const deltaById = new Map<string, { dx: number; dy: number }>()
  for (const ch of positionChanges) {
    const prev = prevById.get(ch.id)
    if (!prev) continue
    const dx = ch.position!.x - prev.position.x
    const dy = ch.position!.y - prev.position.y
    if (dx === 0 && dy === 0) continue
    deltaById.set(ch.id, { dx, dy })
  }
  if (deltaById.size === 0) return edges

  const childrenByParent = new Map<string, string[]>()
  for (const n of nextNodes) {
    const pid = parentIdOf(n)
    if (!pid) continue
    const arr = childrenByParent.get(pid) ?? []
    arr.push(n.id)
    childrenByParent.set(pid, arr)
  }
  // A corrupt row can make a node its own parent (or close a longer cycle),
  // and the walk below would then never terminate — the resulting stack
  // overflow is thrown inside onNodesChange's reducer, so the whole state
  // update is dropped and the node stops moving while still selecting (#370).
  // Mirrors the cycle guard orderParentsFirst already carries.
  const walked = new Set<string>()
  const propagate = (id: string, d: { dx: number; dy: number }) => {
    if (walked.has(id)) return
    walked.add(id)
    for (const childId of childrenByParent.get(id) ?? []) {
      // A directly-dragged child keeps its own delta; don't overwrite it.
      if (!deltaById.has(childId)) deltaById.set(childId, d)
      propagate(childId, d)
    }
  }
  for (const [id, d] of [...deltaById.entries()]) propagate(id, d)

  return edges.map((e) => {
    const data = e.data
    if (!data?.waypoints?.length) return e
    // Both endpoints may have moved (container drag): translate once.
    const d = deltaById.get(e.source) ?? deltaById.get(e.target)
    if (!d) return e
    return {
      ...e,
      data: { ...data, waypoints: data.waypoints.map((wp) => ({ x: wp.x + d.dx, y: wp.y + d.dy })) },
    }
  })
}

/** Key for the live per-service status overlay.
 *  `host` is part of the key because several vhosts can share one port on one
 *  node — without it they'd all read the same status. */
export const serviceStatusKey = (nodeId: string, port?: number, protocol?: string, host?: string | null): string =>
  `${nodeId}:${port ?? ''}/${protocol ?? ''}@${host?.trim() ?? ''}`

interface CanvasState {
  nodes: Node<NodeData>[]
  edges: Edge<EdgeData>[]
  hasUnsavedChanges: boolean
  /**
   * Monotonic counter incremented on every real user edit (auto-bumped whenever
   * an action sets hasUnsavedChanges to true). Consumers that need to react to
   * *edits specifically* — e.g. the autosave debounce — key off this instead of
   * the nodes/edges array identity, which also churns on live status updates and
   * selection changes that must NOT reset the debounce.
   */
  editSeq: number
  selectedNodeId: string | null
  selectedNodeIds: string[]
  scanEventTs: number
  /**
   * The device facts as this canvas received them, per node id. A save diffs
   * against it to tell the backend what *this* canvas edited, so a save made for
   * nothing but a moved node cannot push a stale snapshot over an edit made
   * meanwhile in the Device Inventory. Refreshed on load and on save.
   */
  factsBaseline: Record<string, FactsBaseline>
  /**
   * Apply an inventory row's facts to every node drawing that device, and rebase
   * them. Not an edit — the row is already persisted — so it leaves
   * hasUnsavedChanges alone.
   */
  applyDeviceFacts: (deviceId: string, facts: Partial<NodeData>) => void
  // Live per-service status overlay (not persisted), keyed via serviceStatusKey.
  serviceStatuses: Record<string, ServiceStatus>

  floorMap: FloorMapConfig | null
  setFloorMap: (config: FloorMapConfig | null) => void
  updateFloorMap: (patch: Partial<FloorMapConfig>) => void
  // Bumped when the user double-clicks the floor plan on the canvas, asking the
  // Sidebar to open the active canvas's edit modal (floor plan section).
  floorMapEditNonce: number
  requestFloorMapEdit: () => void

  // History
  past: HistoryEntry[]
  future: HistoryEntry[]
  snapshotHistory: () => void
  undo: () => void
  redo: () => void

  // Clipboard — survives design switches so nodes can be pasted into another design
  clipboard: Clipboard
  copySelectedNodes: () => void
  /** Paste clipboard into the current canvas. `center` (flow coords) lands the
   *  pasted bounding-box center under the cursor / viewport center. */
  pasteNodes: (center?: { x: number; y: number }) => void

  onNodesChange: (changes: NodeChange<Node<NodeData>>[]) => void
  onEdgesChange: (changes: EdgeChange<Edge<EdgeData>>[]) => void
  onConnect: (connection: Connection) => void
  setSelectedNode: (id: string | null) => void
  addNode: (node: Node<NodeData>) => void
  updateNode: (id: string, data: Partial<NodeData>) => void
  /**
   * Apply a live status update to a node WITHOUT marking the canvas unsaved.
   * Status (online/offline, response time, last seen) is transient monitoring
   * data pushed by the backend, not a user edit — dirtying the canvas here would
   * make autosave rewrite an untouched canvas on every status cycle and could
   * clobber edits made elsewhere. Mirrors setServiceStatuses' live-overlay rule.
   */
  setNodeStatus: (id: string, status: Pick<NodeData, 'status' | 'response_time_ms' | 'last_seen'>) => void
  deleteNode: (id: string) => void
  updateEdge: (id: string, data: Partial<EdgeData>) => void
  reconnectEdge: (id: string, connection: Connection) => void
  deleteEdge: (id: string) => void
  setProxmoxContainerMode: (proxmoxId: string, enabled: boolean) => void
  setNodeZIndex: (id: string, zIndex: number) => void
  setNodeSize: (id: string, size: { width?: number; height?: number }) => void
  editingGroupRectId: string | null
  setEditingGroupRectId: (id: string | null) => void
  editingTextId: string | null
  setEditingTextId: (id: string | null) => void
  toggleNodeCollapsed: (id: string) => void
  createGroup: (nodeIds: string[], name: string) => void
  ungroup: (groupId: string) => void
  addToGroup: (groupId: string, childId: string) => void
  addToContainer: (containerId: string, childId: string) => void
  addToZone: (zoneId: string, childId: string) => void
  /** Move every free node whose IP falls in `cidr` into the zone. Returns the
   *  count moved; 0 for an invalid CIDR or no match. */
  importZoneSubnet: (zoneId: string, cidr: string) => number
  removeFromGroup: (groupId: string, childId: string) => void
  markSaved: () => void
  markUnsaved: () => void
  loadCanvas: (nodes: Node<NodeData>[], edges: Edge<EdgeData>[]) => void
  /** In-place canvas replacement (e.g. Auto Layout) that KEEPS undo history and
   *  marks the canvas unsaved. Unlike loadCanvas, it does not wipe past/future —
   *  loadCanvas is for switching designs, this is for transforming the current one. */
  applyLayout: (nodes: Node<NodeData>[], edges: Edge<EdgeData>[]) => void
  fitViewPending: boolean
  clearFitViewPending: () => void
  notifyScanDeviceFound: () => void
  setServiceStatuses: (nodeId: string, statuses: { port?: number; protocol?: string; host?: string | null; status: ServiceStatus }[]) => void
  hideIp: boolean
  toggleHideIp: () => void
  setHideIp: (value: boolean) => void
  applyTypeNodeStyle: (nodeType: NodeType, style: NodeTypeStyle) => void
  applyTypeEdgeStyle: (edgeType: EdgeType, style: EdgeTypeStyle) => void
  applyAllCustomStyles: (def: CustomStyleDef) => void
}

export const useCanvasStore = create<CanvasState>((rawSet, get) => {
  // Wrap set so any update that flips hasUnsavedChanges to true also bumps
  // editSeq. This centralises the "an edit happened" signal instead of touching
  // every one of the ~two dozen mutating actions. Actions that update state
  // without dirtying (setNodeStatus, markSaved, loadCanvas, selection) omit
  // hasUnsavedChanges or set it false, so they never bump the counter.
  const set: typeof rawSet = ((partial, replace) => {
    rawSet((state) => {
      const next = typeof partial === 'function'
        ? (partial as (s: CanvasState) => Partial<CanvasState>)(state)
        : partial
      if (
        next &&
        typeof next === 'object' &&
        (next as Partial<CanvasState>).hasUnsavedChanges === true &&
        !('editSeq' in next)
      ) {
        return { ...next, editSeq: state.editSeq + 1 }
      }
      return next
    }, replace as false | undefined)
  }) as typeof rawSet
  return {
  nodes: [],
  edges: [],
  hasUnsavedChanges: false,
  editSeq: 0,
  selectedNodeId: null,
  selectedNodeIds: [],
  editingGroupRectId: null,
  editingTextId: null,
  hideIp: readHideIp(),
  scanEventTs: 0,
  factsBaseline: {},
  serviceStatuses: {},
  floorMap: null,
  floorMapEditNonce: 0,
  fitViewPending: false,

  past: [],
  future: [],
  clipboard: { nodes: [], edges: [] },

  snapshotHistory: () =>
    set((state) => ({
      past: [...state.past.slice(-49), { nodes: state.nodes, edges: state.edges }],
      future: [],
    })),

  undo: () =>
    set((state) => {
      if (state.past.length === 0) return state
      const previous = state.past[state.past.length - 1]
      return {
        nodes: previous.nodes,
        edges: previous.edges,
        past: state.past.slice(0, -1),
        future: [{ nodes: state.nodes, edges: state.edges }, ...state.future.slice(0, 49)],
        hasUnsavedChanges: true,
      }
    }),

  redo: () =>
    set((state) => {
      if (state.future.length === 0) return state
      const next = state.future[0]
      return {
        nodes: next.nodes,
        edges: next.edges,
        past: [...state.past.slice(-49), { nodes: state.nodes, edges: state.edges }],
        future: state.future.slice(1),
        hasUnsavedChanges: true,
      }
    }),

  copySelectedNodes: () =>
    set((state) => {
      // Start from explicitly selected nodes, then pull in all descendants so a
      // copied group / container brings its children along.
      const ids = new Set(state.nodes.filter((n) => n.selected).map((n) => n.id))
      if (ids.size === 0) return { clipboard: { nodes: [], edges: [] } }
      let grew = true
      while (grew) {
        grew = false
        for (const n of state.nodes) {
          const pid = parentIdOf(n)
          if (pid && ids.has(pid) && !ids.has(n.id)) {
            ids.add(n.id)
            grew = true
          }
        }
      }
      const nodes = state.nodes.filter((n) => ids.has(n.id))
      // Keep only edges whose both endpoints are inside the copied set.
      const edges = state.edges.filter((e) => ids.has(e.source) && ids.has(e.target))
      return { clipboard: { nodes, edges } }
    }),

  pasteNodes: (center) =>
    set((state) => {
      const clip = state.clipboard
      if (clip.nodes.length === 0) return state

      // Fresh ids for every copied node; edges/parent links are remapped through it.
      const idMap = new Map<string, string>()
      clip.nodes.forEach((n) => idMap.set(n.id, generateUUID()))

      // A "root" is a copied node whose parent was not also copied — these carry
      // absolute positions and receive the paste offset; children move with them.
      const isRoot = (n: Node<NodeData>) => {
        const pid = parentIdOf(n)
        return !pid || !idMap.has(pid)
      }
      const roots = clip.nodes.filter(isRoot)

      // Default cascade offset; when a target center is given, shift the root
      // bounding-box center onto it instead.
      let offsetX = 50
      let offsetY = 50
      if (center && roots.length > 0) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
        for (const n of roots) {
          const w = n.width ?? n.measured?.width ?? 200
          const h = n.height ?? n.measured?.height ?? 80
          minX = Math.min(minX, n.position.x)
          minY = Math.min(minY, n.position.y)
          maxX = Math.max(maxX, n.position.x + w)
          maxY = Math.max(maxY, n.position.y + h)
        }
        offsetX = center.x - (minX + maxX) / 2
        offsetY = center.y - (minY + maxY) / 2
      }

      const pasted = clip.nodes.map((n) => {
        const root = isRoot(n)
        const newParentId = root ? undefined : idMap.get(parentIdOf(n)!)
        return {
          ...n,
          id: idMap.get(n.id)!,
          position: root
            ? { x: n.position.x + offsetX, y: n.position.y + offsetY }
            : { ...n.position },
          selected: true,
          parentId: newParentId,
          extent: newParentId ? ('parent' as const) : undefined,
          data: { ...n.data, parent_id: newParentId },
        }
      })

      const pastedEdges = clip.edges.map((e) => ({
        ...e,
        id: generateUUID(),
        source: idMap.get(e.source)!,
        target: idMap.get(e.target)!,
        selected: false,
      }))

      // React Flow requires parents before children within the appended block.
      const parents = pasted.filter((n) => !n.parentId)
      const children = pasted.filter((n) => !!n.parentId)
      const pastedNodes = [...parents, ...children]

      // Deselect everything already on the canvas so only the paste is selected.
      const existing = state.nodes.map((n) => (n.selected ? { ...n, selected: false } : n))

      return {
        nodes: [...existing, ...pastedNodes],
        edges: [...state.edges, ...pastedEdges],
        selectedNodeId: null,
        selectedNodeIds: pastedNodes.map((n) => n.id),
        past: [...state.past.slice(-49), { nodes: state.nodes, edges: state.edges }],
        future: [],
        hasUnsavedChanges: true,
      }
    }),

  onNodesChange: (changes) =>
    set((state) => {
      const nodes = applyNodeChanges(changes, state.nodes)
      const selectedNodeIds = nodes.filter((n) => n.selected).map((n) => n.id)
      // Manually-placed edge waypoints are stored as absolute canvas coords, so
      // they don't follow a moved node on their own. Translate them by the same
      // delta the node moved so a clean routing stays clean after a drag (#279).
      const edges = translateWaypointsForMovedNodes(changes, state.nodes, nodes, state.edges)
      // Only set hasUnsavedChanges when a real edit occurred, so the set() wrapper
      // bumps editSeq only then. Selection- or measure-only changes leave the flag
      // untouched (carried over) and must not reset the autosave debounce.
      const edited = changes.some(isUserNodeEdit)
      return {
        nodes,
        edges,
        selectedNodeIds,
        ...(edited ? { hasUnsavedChanges: true } : {}),
      }
    }),

  onEdgesChange: (changes) =>
    set((state) => {
      const edited = changes.some((c) => c.type !== 'select')
      return {
        edges: applyEdgeChanges(changes, state.edges),
        ...(edited ? { hasUnsavedChanges: true } : {}),
      }
    }),

  onConnect: (connection) =>
    set((state) => {
      const extra = connection as Connection & Partial<EdgeData>
      const edgeType = extra.type ?? 'ethernet'
      // Build the edge with our own unique id and append directly instead of
      // React Flow's addEdge(): addEdge silently drops any new edge whose
      // source+target already match an existing edge when handles are null/equal
      // (connectionExists dedupe). A homelab legitimately has multiple links
      // between the same two devices, so we allow them.
      const newEdge: Edge<EdgeData> = {
        id: `edge-${generateUUID()}`,
        source: connection.source,
        target: connection.target,
        sourceHandle: normalizeHandle(extra.sourceHandle),
        targetHandle: normalizeHandle(extra.targetHandle),
        type: edgeType,
        data: { type: edgeType, label: extra.label, vlan_id: extra.vlan_id, custom_color: extra.custom_color, path_style: extra.path_style, line_style: extra.line_style, width_mult: extra.width_mult, animated: extra.animated, marker_start: extra.marker_start, marker_end: extra.marker_end },
      }
      return {
        edges: [...state.edges, newEdge],
        hasUnsavedChanges: true,
      }
    }),

  setSelectedNode: (id) => set({
    selectedNodeId: id,
    selectedNodeIds: id ? [id] : [],
  }),

  addNode: (node) =>
    set((state) => {
      // Same rule as updateNode: never let a node parent itself (#370).
      if (node.data.parent_id === node.id) {
        node = { ...node, data: { ...node.data, parent_id: undefined }, parentId: undefined, extent: undefined }
      }
      const parent = node.data.parent_id ? state.nodes.find((n) => n.id === node.data.parent_id) : null
      // A visual group — and a groupRect zone — nests its children just like a
      // container-mode host.
      const shouldNestInParent = !!(parent?.data.container_mode) || parent?.data.type === 'group' || parent?.data.type === 'groupRect'
      // Zones keep their children free to be dragged back out (see addToZone).
      const nestExtent = parent?.data.type === 'groupRect' ? undefined : ('parent' as const)
      const enriched = node.data.parent_id && shouldNestInParent
        ? {
            ...node,
            parentId: node.data.parent_id,
            extent: nestExtent,
            position: {
              x: Math.max(10, node.position.x - parent.position.x),
              y: Math.max(10, node.position.y - parent.position.y),
            },
          }
        // Not nesting: strip any parentId/extent a caller may have set so a
        // non-container parent can't trap the node in its bounding box.
        : { ...node, parentId: undefined, extent: undefined }
      // Parents must come before children in the array (React Flow requirement)
      const withoutNew = state.nodes.filter((n) => n.id !== node.id)
      if (enriched.parentId) {
        const parentIdx = withoutNew.findIndex((n) => n.id === enriched.parentId)
        const insertAt = parentIdx >= 0 ? parentIdx + 1 : withoutNew.length
        const nodes = [...withoutNew.slice(0, insertAt), enriched, ...withoutNew.slice(insertAt)]
        return { nodes, hasUnsavedChanges: true }
      }
      return { nodes: [...withoutNew, enriched], hasUnsavedChanges: true }
    }),

  updateNode: (id, incoming) =>
    set((state) => {
      // A node can never be its own parent. Every parent walk (waypoint
      // propagation, parents-before-children ordering, collapse) assumes an
      // acyclic tree, and the row survives a save, so the canvas comes back
      // broken on the next load (#370). Drop the key and apply the rest.
      let data = incoming
      if (incoming.parent_id === id) {
        data = { ...incoming }
        delete data.parent_id
      }
      let nodes = state.nodes.map((n) => {
        if (n.id !== id) return n
        const updated: Node<NodeData> = { ...n, data: { ...n.data, ...data } }
        // When properties change, clear stored height so the node auto-sizes to fit new content.
        // A container-mode host (vm/lxc/docker_host) keeps a manually-set height: resetting it
        // snaps the container back to auto-fit size and scrambles its nested children (#278).
        // proxmox is always excluded (legacy behavior); the other container types are excluded
        // only while actually in container mode.
        const isContainerHost = CONTAINER_MODE_TYPES.has(n.data.type) && !!n.data.container_mode
        if ('properties' in data && n.data.type !== 'proxmox' && n.data.type !== 'groupRect' && n.data.type !== 'group' && !isContainerHost) {
          updated.height = undefined
        }
        if ('parent_id' in data) {
          const newParentId = data.parent_id ?? undefined
          if (!newParentId && n.parentId) {
            // Detaching from a container: convert position back to absolute canvas coords
            const parent = state.nodes.find((p) => p.id === n.parentId)
            if (parent) {
              updated.position = {
                x: parent.position.x + n.position.x,
                y: parent.position.y + n.position.y,
              }
            }
            updated.parentId = undefined
            updated.extent = undefined
          } else if (newParentId && newParentId !== n.parentId) {
            const parent = state.nodes.find((p) => p.id === newParentId)
            if (parent?.data.container_mode || parent?.data.type === 'group' || parent?.data.type === 'groupRect') {
              // Attaching to a container-mode host, a visual group or a zone.
              updated.parentId = newParentId
              updated.extent = parent.data.type === 'groupRect' ? undefined : ('parent' as const)
              // Convert absolute position to parent-relative (keep node visible inside)
              updated.position = {
                x: Math.max(10, n.position.x - parent.position.x),
                y: Math.max(10, n.position.y - parent.position.y),
              }
            }
          }
        }
        return updated
      })
      // React Flow requires parent nodes to precede their children in the array
      if ('parent_id' in data) {
        const parents = nodes.filter((n) => !n.parentId)
        const children = nodes.filter((n) => !!n.parentId)
        nodes = [...parents, ...children]
      }
      // Remap edges when any side's handle count is reduced so no edge disappears.
      // Removed handles fall back to the side's slot-0 id, or 'bottom' if the
      // side dropped to 0 (its slot-0 id no longer exists).
      let edges = state.edges
      const currentNode = state.nodes.find((n) => n.id === id)
      for (const side of SIDES) {
        const field = handleCountField(side)
        if (!(field in data) || data[field] == null) continue
        const oldCount = currentNode?.data[field] ?? sideDefault(side)
        const newCount = data[field] as number
        if (newCount >= oldCount) continue
        const removed = removedHandleIds(side, oldCount, newCount)
        const fallback = newCount === 0 ? 'bottom' : handleId(side, 0)
        edges = edges.map((e) => {
          if (e.source === id && e.sourceHandle && removed.has(e.sourceHandle))
            return { ...e, sourceHandle: fallback }
          if (e.target === id && e.targetHandle && removed.has(e.targetHandle))
            return { ...e, targetHandle: fallback }
          return e
        })
      }

      return { nodes, edges, hasUnsavedChanges: true }
    }),

  setNodeStatus: (id, status) =>
    set((state) => {
      let changed = false
      const nodes = state.nodes.map((n) => {
        if (n.id !== id) return n
        changed = true
        return { ...n, data: { ...n.data, ...status } }
      })
      // No hasUnsavedChanges: live status is monitoring data, not a user edit.
      return changed ? { nodes } : {}
    }),

  deleteNode: (id) =>
    set((state) => {
      const idsToRemove = new Set<string>()
      // Deleting a zone deletes the zone, never what it happens to contain:
      // its children are released back to the canvas in absolute coords.
      const released: Node<NodeData>[] = []
      const collect = (nodeId: string) => {
        idsToRemove.add(nodeId)
        const node = state.nodes.find((n) => n.id === nodeId)
        const children = state.nodes.filter((n) => n.parentId === nodeId)
        if (node?.data.type === 'groupRect') {
          children.forEach((c) => released.push({
            ...c,
            parentId: undefined,
            extent: undefined,
            position: {
              x: node.position.x + c.position.x,
              y: node.position.y + c.position.y,
            },
            data: { ...c.data, parent_id: undefined },
          }))
          return
        }
        children.forEach((n) => collect(n.id))
      }
      collect(id)
      const releasedById = new Map(released.map((n) => [n.id, n]))
      return {
        nodes: state.nodes
          .filter((n) => !idsToRemove.has(n.id))
          .map((n) => releasedById.get(n.id) ?? n),
        edges: state.edges.filter((e) => !idsToRemove.has(e.source) && !idsToRemove.has(e.target)),
        selectedNodeId: idsToRemove.has(state.selectedNodeId ?? '') ? null : state.selectedNodeId,
        hasUnsavedChanges: true,
      }
    }),

  updateEdge: (id, data) =>
    set((state) => ({
      edges: state.edges.map((e) =>
        e.id === id ? { ...e, type: data.type ?? e.type, data: { ...e.data, ...data } as EdgeData } : e
      ),
      hasUnsavedChanges: true,
    })),

  reconnectEdge: (id, connection) =>
    set((state) => ({
      edges: state.edges.map((e) =>
        e.id === id
          ? {
              ...e,
              source: connection.source ?? e.source,
              target: connection.target ?? e.target,
              sourceHandle: normalizeHandle(connection.sourceHandle),
              targetHandle: normalizeHandle(connection.targetHandle),
            }
          : e
      ),
      past: [...state.past.slice(-49), { nodes: state.nodes, edges: state.edges }],
      future: [],
      hasUnsavedChanges: true,
    })),

  deleteEdge: (id) =>
    set((state) => ({
      edges: state.edges.filter((e) => e.id !== id),
      hasUnsavedChanges: true,
    })),

  setProxmoxContainerMode: (proxmoxId, enabled) =>
    set((state) => {
      const parentNode = state.nodes.find((n) => n.id === proxmoxId)
      let nodes = state.nodes.map((n) => {
        if (n.id === proxmoxId) {
          const withMode = { ...n, data: { ...n.data, container_mode: enabled } }
          return enabled
            ? { ...withMode, width: n.width ?? 300, height: n.height ?? 200 }
            : { ...withMode, width: undefined, height: undefined }
        }
        if (n.data.parent_id === proxmoxId) {
          // Idempotency guard: only convert a child's position when its nesting
          // state actually changes. A child that already matches the target mode
          // keeps its position untouched -- re-running the absolute<->relative
          // conversion on an already-relative child corrupts it (children pile
          // into a corner). See handleUpdateNode in App.tsx.
          const alreadyNested = n.parentId === proxmoxId && n.extent === 'parent'
          if (enabled && parentNode) {
            if (alreadyNested) return n
            return {
              ...n,
              parentId: proxmoxId,
              extent: 'parent' as const,
              position: {
                x: Math.max(10, n.position.x - parentNode.position.x),
                y: Math.max(10, n.position.y - parentNode.position.y),
              },
            }
          }
          if (!enabled && parentNode) {
            if (!n.parentId) return n
            return {
              ...n,
              parentId: undefined,
              extent: undefined,
              position: {
                x: parentNode.position.x + n.position.x,
                y: parentNode.position.y + n.position.y,
              },
            }
          }
          return enabled
            ? { ...n, parentId: proxmoxId, extent: 'parent' as const }
            : { ...n, parentId: undefined, extent: undefined }
        }
        return n
      })
      if (enabled) {
        const parents = nodes.filter((n) => !n.parentId)
        const children = nodes.filter((n) => !!n.parentId)
        nodes = [...parents, ...children]
      }
      return { nodes, hasUnsavedChanges: true }
    }),

  setNodeZIndex: (id, zIndex) =>
    set((state) => ({
      nodes: state.nodes.map((n) => n.id === id ? { ...n, zIndex } : n),
      hasUnsavedChanges: true,
    })),

  // Manual width/height entry. Lets the user type an exact size instead of
  // dragging the resize handle (which lands on fractional content-fit pixels).
  // A clamp matches the NodeResizer minimums so the box can't collapse.
  setNodeSize: (id, size) =>
    set((state) => ({
      nodes: state.nodes.map((n) => {
        if (n.id !== id) return n
        return {
          ...n,
          ...(size.width != null ? { width: Math.max(140, size.width) } : {}),
          ...(size.height != null ? { height: Math.max(50, size.height) } : {}),
        }
      }),
      hasUnsavedChanges: true,
    })),

  setEditingGroupRectId: (id) => set({ editingGroupRectId: id }),

  setEditingTextId: (id) => set({ editingTextId: id }),

  toggleNodeCollapsed: (id) =>
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === id
          ? { ...n, data: { ...n.data, collapsed: !n.data.collapsed } }
          : n
      ),
      hasUnsavedChanges: true,
    })),

  createGroup: (nodeIds, name) =>
    set((state) => {
      const PADDING_H = 24
      const PADDING_TOP = 48
      const PADDING_BOTTOM = 24
      const targets = state.nodes.filter((n) => nodeIds.includes(n.id))
      if (targets.length === 0) return state

      // Bounding box in absolute coordinates
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (const n of targets) {
        const w = n.width ?? 200
        const h = n.height ?? 80
        minX = Math.min(minX, n.position.x)
        minY = Math.min(minY, n.position.y)
        maxX = Math.max(maxX, n.position.x + w)
        maxY = Math.max(maxY, n.position.y + h)
      }

      const groupX = minX - PADDING_H
      const groupY = minY - PADDING_TOP
      const groupW = maxX - minX + PADDING_H * 2
      const groupH = maxY - minY + PADDING_TOP + PADDING_BOTTOM

      const groupId = generateUUID()
      const groupNode: Node<NodeData> = {
        id: groupId,
        type: 'group',
        position: { x: groupX, y: groupY },
        width: groupW,
        height: groupH,
        data: {
          label: name,
          type: 'group',
          status: 'unknown',
          services: [],
          custom_colors: { show_border: true },
        },
        selected: false,
      }

      // Convert children to relative positions and assign parentId
      const updatedNodes = state.nodes.map((n) => {
        if (!nodeIds.includes(n.id)) return n
        return {
          ...n,
          parentId: groupId,
          extent: 'parent' as const,
          position: {
            x: n.position.x - groupX,
            y: n.position.y - groupY,
          },
          selected: false,
          data: { ...n.data, parent_id: groupId },
        }
      })

      // Group node must come before its children
      const withoutTargets = updatedNodes.filter((n) => !nodeIds.includes(n.id))
      const children = updatedNodes.filter((n) => nodeIds.includes(n.id))
      const nodes = [...withoutTargets, groupNode, ...children]

      return {
        nodes,
        selectedNodeIds: [],
        selectedNodeId: null,
        hasUnsavedChanges: true,
        past: [...state.past.slice(-49), { nodes: state.nodes, edges: state.edges }],
        future: [],
      }
    }),

  ungroup: (groupId) =>
    set((state) => {
      const group = state.nodes.find((n) => n.id === groupId)
      if (!group) return state

      const groupAbsX = group.position.x
      const groupAbsY = group.position.y

      const nodes = state.nodes
        .filter((n) => n.id !== groupId)
        .map((n) => {
          if (n.parentId !== groupId) return n
          return {
            ...n,
            parentId: undefined,
            extent: undefined,
            position: {
              x: n.position.x + groupAbsX,
              y: n.position.y + groupAbsY,
            },
            data: { ...n.data, parent_id: undefined },
          }
        })

      return {
        nodes,
        selectedNodeId: null,
        selectedNodeIds: [],
        hasUnsavedChanges: true,
        past: [...state.past.slice(-49), { nodes: state.nodes, edges: state.edges }],
        future: [],
      }
    }),

  // Nest an existing top-level node inside a group. Inverse of removeFromGroup.
  addToGroup: (groupId, childId) =>
    set((state) => {
      const group = state.nodes.find((n) => n.id === groupId)
      const child = state.nodes.find((n) => n.id === childId)
      if (!group || !child || group.data.type !== 'group') return state
      if (child.id === groupId || child.parentId === groupId) return state

      const updatedNodes = state.nodes.map((n) => {
        if (n.id !== childId) return n
        return {
          ...n,
          parentId: groupId,
          extent: 'parent' as const,
          // Absolute → group-relative. Clamp so the node stays inside the box.
          position: {
            x: Math.max(8, n.position.x - group.position.x),
            y: Math.max(8, n.position.y - group.position.y),
          },
          selected: false,
          data: { ...n.data, parent_id: groupId },
        }
      })

      // React Flow requires the parent to precede its children in the array.
      const others = updatedNodes.filter((n) => n.id !== childId)
      const movedChild = updatedNodes.find((n) => n.id === childId)!
      const groupIdx = others.findIndex((n) => n.id === groupId)
      const nodes = [
        ...others.slice(0, groupIdx + 1),
        movedChild,
        ...others.slice(groupIdx + 1),
      ]

      return {
        nodes,
        hasUnsavedChanges: true,
        past: [...state.past.slice(-49), { nodes: state.nodes, edges: state.edges }],
        future: [],
      }
    }),

  // Nest an existing top-level node inside a container node (proxmox /
  // docker_host / … in container_mode). Mirrors addToGroup but the target is
  // any node with data.container_mode === true rather than a group.
  addToContainer: (containerId, childId) =>
    set((state) => {
      const container = state.nodes.find((n) => n.id === containerId)
      const child = state.nodes.find((n) => n.id === childId)
      if (!container || !child || container.data.container_mode !== true) return state
      if (child.id === containerId || child.parentId === containerId) return state

      const updatedNodes = state.nodes.map((n) => {
        if (n.id !== childId) return n
        return {
          ...n,
          parentId: containerId,
          extent: 'parent' as const,
          // Absolute → container-relative. Clamp so the node stays inside.
          position: {
            x: Math.max(8, n.position.x - container.position.x),
            y: Math.max(8, n.position.y - container.position.y),
          },
          selected: false,
          data: { ...n.data, parent_id: containerId },
        }
      })

      // React Flow requires the parent to precede its children in the array.
      const others = updatedNodes.filter((n) => n.id !== childId)
      const movedChild = updatedNodes.find((n) => n.id === childId)!
      const containerIdx = others.findIndex((n) => n.id === containerId)
      const nodes = [
        ...others.slice(0, containerIdx + 1),
        movedChild,
        ...others.slice(containerIdx + 1),
      ]

      return {
        nodes,
        hasUnsavedChanges: true,
        past: [...state.past.slice(-49), { nodes: state.nodes, edges: state.edges }],
        future: [],
      }
    }),

  // Nest an existing top-level node inside a groupRect zone. Mirrors
  // addToGroup, with one deliberate difference: NO `extent: 'parent'`. A zone
  // is a loose visual area, so a child must stay draggable out of it — the
  // canvas detaches it on drop (see CanvasContainer). Parenting is what makes
  // moving the zone move its contents.
  addToZone: (zoneId, childId) =>
    set((state) => {
      const zone = state.nodes.find((n) => n.id === zoneId)
      const child = state.nodes.find((n) => n.id === childId)
      if (!zone || !child || zone.data.type !== 'groupRect') return state
      if (child.id === zoneId || child.parentId === zoneId) return state
      // A zone cannot become a child of a node it already contains.
      if (zone.parentId === childId) return state

      const updatedNodes = state.nodes.map((n) => {
        if (n.id !== childId) return n
        return {
          ...n,
          parentId: zoneId,
          // Absolute → zone-relative.
          position: {
            x: n.position.x - zone.position.x,
            y: n.position.y - zone.position.y,
          },
          selected: false,
          data: { ...n.data, parent_id: zoneId },
        }
      })

      // React Flow requires the parent to precede its children in the array.
      const others = updatedNodes.filter((n) => n.id !== childId)
      const movedChild = updatedNodes.find((n) => n.id === childId)!
      const zoneIdx = others.findIndex((n) => n.id === zoneId)
      const nodes = [
        ...others.slice(0, zoneIdx + 1),
        movedChild,
        ...others.slice(zoneIdx + 1),
      ]

      return {
        nodes,
        hasUnsavedChanges: true,
        past: [...state.past.slice(-49), { nodes: state.nodes, edges: state.edges }],
        future: [],
      }
    }),

  // Pull every free node whose IP falls inside `cidr` into a zone, laying them
  // out on a grid in the zone's free space. Deliberately additive and one-shot:
  // the CIDR is never stored, nothing is ever ejected, and running it twice with
  // two subnets leaves both sets inside. Undo reverses the whole import at once.
  importZoneSubnet: (zoneId, cidr) => {
    const state = get()
    const zone = state.nodes.find((n) => n.id === zoneId)
    if (!zone || zone.data.type !== 'groupRect') return 0
    if (!isValidCidr(cidr)) return 0

    const matches = state.nodes.filter((n) => isZoneSubnetCandidate(n, cidr, zoneId))
    if (matches.length === 0) return 0

    const moved = new Set(matches.map((n) => n.id))
    const zoneWidth = zone.width ?? DEFAULT_ZONE_WIDTH
    const zoneHeight = zone.height ?? DEFAULT_ZONE_HEIGHT

    // Boxes already inside the zone, in zone-relative coordinates. New arrivals
    // are packed around them rather than on top of them.
    const occupied = state.nodes
      .filter((n) => n.parentId === zoneId && !moved.has(n.id))
      .map((n) => ({
        x: n.position.x,
        y: n.position.y,
        w: n.width ?? ZONE_CELL_W - ZONE_CELL_GAP,
        h: n.height ?? ZONE_CELL_H - ZONE_CELL_GAP,
      }))

    const columns = Math.max(1, Math.floor((zoneWidth - ZONE_PAD_X) / ZONE_CELL_W))
    const overlaps = (x: number, y: number) =>
      occupied.some(
        (b) =>
          x < b.x + b.w &&
          x + ZONE_CELL_W - ZONE_CELL_GAP > b.x &&
          y < b.y + b.h &&
          y + ZONE_CELL_H - ZONE_CELL_GAP > b.y,
      )

    // Row-major scan for the first free cell per arrival. Rows keep going past
    // the current height; the zone grows at the end to cover the last one used.
    const placements = new Map<string, { x: number; y: number }>()
    let cursor = 0
    let maxBottom = 0
    for (const node of matches) {
      let x = 0
      let y = 0
      for (;;) {
        x = ZONE_PAD_X / 2 + (cursor % columns) * ZONE_CELL_W
        y = ZONE_PAD_TOP + Math.floor(cursor / columns) * ZONE_CELL_H
        cursor += 1
        if (!overlaps(x, y)) break
      }
      placements.set(node.id, { x, y })
      occupied.push({ x, y, w: ZONE_CELL_W - ZONE_CELL_GAP, h: ZONE_CELL_H - ZONE_CELL_GAP })
      maxBottom = Math.max(maxBottom, y + ZONE_CELL_H)
    }

    const grownHeight = Math.max(zoneHeight, maxBottom + ZONE_PAD_BOTTOM)

    set((s) => {
      const updated = s.nodes.map((n) => {
        // `height` is the only field to write: the serializer persists it to
        // the real `nodes.height` column, and keeps it out of the style blob.
        if (n.id === zoneId) {
          return grownHeight === zoneHeight ? n : { ...n, height: grownHeight }
        }
        const at = placements.get(n.id)
        if (!at) return n
        return {
          ...n,
          parentId: zoneId,
          position: at,
          selected: false,
          data: { ...n.data, parent_id: zoneId },
        }
      })

      return {
        // React Flow requires a parent to precede its children in the array.
        // Reordering the whole list covers both directions at once: the zone
        // ahead of its new children, and an arrival that is itself a parent
        // (a Proxmox host with nested VMs, whose children stay put because
        // they already have a parent) ahead of the children it left behind.
        nodes: orderParentsFirst(updated),
        hasUnsavedChanges: true,
        past: [...s.past.slice(-49), { nodes: s.nodes, edges: s.edges }],
        future: [],
      }
    })

    return matches.length
  },

  // Release a single child from a group back to the canvas. Group stays.
  removeFromGroup: (groupId, childId) =>
    set((state) => {
      const group = state.nodes.find((n) => n.id === groupId)
      const child = state.nodes.find((n) => n.id === childId)
      if (!group || !child || child.parentId !== groupId) return state

      const nodes = state.nodes.map((n) => {
        if (n.id !== childId) return n
        return {
          ...n,
          parentId: undefined,
          extent: undefined,
          position: {
            x: n.position.x + group.position.x,
            y: n.position.y + group.position.y,
          },
          data: { ...n.data, parent_id: undefined },
        }
      })

      return {
        nodes,
        hasUnsavedChanges: true,
        past: [...state.past.slice(-49), { nodes: state.nodes, edges: state.edges }],
        future: [],
      }
    }),

  // The save just became the server's truth, so it is the new baseline: the next
  // save reports only what is edited from here on.
  markSaved: () => set((state) => ({ hasUnsavedChanges: false, factsBaseline: factsBaselines(state.nodes) })),

  applyDeviceFacts: (deviceId, facts) =>
    set((state) => {
      let changed = false
      const factsBaseline = { ...state.factsBaseline }
      const nodes = state.nodes.map((n) => {
        if (n.data.device_id !== deviceId) return n
        const previous = state.factsBaseline[n.id]
        // A fact this canvas has already edited but not saved is the user's
        // work in progress — the row does not get to overwrite it on screen.
        const pending = new Set<string>(changedFactFields(n.data, previous))
        const applied = Object.fromEntries(
          Object.entries(facts).filter(([field]) => !pending.has(field)),
        )
        if (Object.keys(applied).length === 0) return n
        changed = true
        const data = { ...n.data, ...applied }
        // The row owns the facts, this node owns how they are laid out: an
        // inventory edit updates the values in place rather than replacing the
        // arrangement, and a service the row just gained arrives hidden.
        if (Array.isArray(applied.services)) {
          data.services = listArrangedForNode(n.data.services, applied.services)
        }
        if (Array.isArray(applied.properties)) {
          data.properties = listArrangedForNode(n.data.properties, applied.properties)
        }
        // Rebase only what was applied: an untouched pending edit stays reported
        // as this canvas' change so the next save still writes it.
        const rebased = factsBaselineOf(data)
        for (const field of pending) {
          if (previous?.[field] !== undefined) rebased[field] = previous[field]
        }
        factsBaseline[n.id] = rebased
        return { ...n, data }
      })
      // No hasUnsavedChanges: the row already holds this, the canvas is catching
      // up. Rebasing alongside is what keeps the next save from claiming the
      // inventory's own edit as a canvas edit.
      return changed ? { nodes, factsBaseline } : {}
    }),

  markUnsaved: () => set({ hasUnsavedChanges: true }),

  notifyScanDeviceFound: () => set({ scanEventTs: Date.now() }),

  setServiceStatuses: (nodeId, statuses) =>
    set((state) => {
      // Live overlay only — never touches node data, so it stays out of saves.
      const next = { ...state.serviceStatuses }
      for (const s of statuses) {
        next[serviceStatusKey(nodeId, s.port, s.protocol, s.host)] = s.status
      }
      return { serviceStatuses: next }
    }),

  toggleHideIp: () => set((s) => {
    const hideIp = !s.hideIp
    writeHideIp(hideIp)
    return { hideIp }
  }),

  setHideIp: (value) => {
    writeHideIp(value)
    set({ hideIp: value })
  },

  setFloorMap: (config) => set({ floorMap: config, hasUnsavedChanges: true }),

  updateFloorMap: (patch) =>
    set((state) => ({
      floorMap: state.floorMap ? { ...state.floorMap, ...patch } : null,
      hasUnsavedChanges: true,
    })),

  requestFloorMapEdit: () => set((s) => ({ floorMapEditNonce: s.floorMapEditNonce + 1 })),

  loadCanvas: (nodes, edges) => {
    // React Flow requires parents before children in the array
    const parents = nodes.filter((n) => !n.parentId)
    const children = nodes.filter((n) => !!n.parentId)
    // NOTE: clipboard is intentionally preserved here so nodes copied in one
    // design can be pasted after switching to another design.
    set({
      nodes: [...parents, ...children],
      edges,
      hasUnsavedChanges: false,
      selectedNodeId: null,
      past: [],
      future: [],
      fitViewPending: true,
      // What the server just gave us: the reference a save diffs against.
      factsBaseline: factsBaselines(nodes),
    })
  },

  applyLayout: (nodes, edges) =>
    set((state) => {
      // React Flow requires parents before children in the array
      const parents = nodes.filter((n) => !n.parentId)
      const children = nodes.filter((n) => !!n.parentId)
      return {
        nodes: [...parents, ...children],
        edges,
        past: [...state.past.slice(-49), { nodes: state.nodes, edges: state.edges }],
        future: [],
        hasUnsavedChanges: true,
        selectedNodeId: null,
        fitViewPending: true,
      }
    }),

  clearFitViewPending: () => set({ fitViewPending: false }),

  applyTypeNodeStyle: (nodeType, style) =>
    set((state) => ({
      nodes: state.nodes.map((n) => {
        if (n.data.type !== nodeType) return n
        return {
          ...n,
          width: style.width > 0 ? style.width : n.width,
          height: style.height > 0 ? style.height : n.height,
          data: {
            ...n.data,
            custom_colors: {
              ...n.data.custom_colors,
              border: applyOpacity(style.borderColor, style.borderOpacity),
              background: applyOpacity(style.bgColor, style.bgOpacity),
              icon: applyOpacity(style.iconColor, style.iconOpacity),
            },
          },
        }
      }),
      hasUnsavedChanges: true,
    })),

  applyTypeEdgeStyle: (edgeType, style) =>
    set((state) => ({
      edges: state.edges.map((e) => {
        if ((e.data?.type ?? 'ethernet') !== edgeType) return e
        return {
          ...e,
          data: {
            ...e.data,
            type: edgeType,
            custom_color: applyOpacity(style.color, style.opacity),
            path_style: style.pathStyle,
            line_style: style.lineStyle,
            width_mult: style.widthMult,
            animated: style.animated,
            marker_start: style.arrowStart,
            marker_end: style.arrowEnd,
          } as EdgeData,
        }
      }),
      hasUnsavedChanges: true,
    })),

  applyAllCustomStyles: (def) =>
    set((state) => {
      const nodes = state.nodes.map((n) => {
        const style = def.nodes[n.data.type]
        if (!style) return n
        return {
          ...n,
          width: style.width > 0 ? style.width : n.width,
          height: style.height > 0 ? style.height : n.height,
          data: {
            ...n.data,
            custom_colors: {
              ...n.data.custom_colors,
              border: applyOpacity(style.borderColor, style.borderOpacity),
              background: applyOpacity(style.bgColor, style.bgOpacity),
              icon: applyOpacity(style.iconColor, style.iconOpacity),
            },
          },
        }
      })
      const edges = state.edges.map((e) => {
        const edgeType = (e.data?.type ?? 'ethernet') as EdgeType
        const style = def.edges[edgeType]
        if (!style) return e
        return {
          ...e,
          data: {
            ...e.data,
            type: edgeType,
            custom_color: applyOpacity(style.color, style.opacity),
            path_style: style.pathStyle,
            line_style: style.lineStyle,
            width_mult: style.widthMult,
            animated: style.animated,
            marker_start: style.arrowStart,
            marker_end: style.arrowEnd,
          } as EdgeData,
        }
      })
      return { nodes, edges, hasUnsavedChanges: true }
    }),
  }
})

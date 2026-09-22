import type { Node, Edge } from '@xyflow/react'
import type { NodeData, EdgeData } from '@/types'
import { NODE_TYPE_GROUPS, FURNITURE_TYPES } from '@/utils/nodeTypeGroups'
import { ipToInt } from '@/utils/subnet'
import { generateUUID } from '@/utils/uuid'

/**
 * Auto Layout modes (#326). `hierarchy` is the plain Dagre tree; the other two
 * first sort the free devices into zones — one per device family, or one per
 * /24 — and then run the same tree over the zones and whatever stayed loose.
 */
export type AutoLayoutMode = 'hierarchy' | 'type' | 'subnet'

// Zone geometry, in zone-relative pixels. Matches the zone subnet import in the
// store: a 360×240 zone, a label band at the top, a card-sized default box.
const ZONE_MIN_WIDTH = 360
const ZONE_MIN_HEIGHT = 240
const PAD_X = 16
const PAD_TOP = 40
const PAD_BOTTOM = 16
const GAP = 20
const DEFAULT_BOX_W = 160
const DEFAULT_BOX_H = 90
const MAX_COLUMNS = 4

const TYPE_ORDER = NODE_TYPE_GROUPS.map((g) => g.label)
const OTHER_LABEL = 'Other'

/** The zone a node type belongs to: its family in the type picker. */
export function typeGroupLabel(type: string): string {
  return NODE_TYPE_GROUPS.find((g) => (g.types as string[]).includes(type))?.label ?? OTHER_LABEL
}

/**
 * The /24 an address sits in, as "192.168.1.0/24". A prefix or a port on the
 * stored value is stripped, as `ipInSubnet` does. Null for no or non-IPv4 address.
 */
export function subnetGroupLabel(ip: string | null | undefined): string | null {
  if (!ip) return null
  const value = ipToInt(ip.trim().split('/')[0].split(':')[0])
  if (value === null) return null
  const base = (value & 0xffffff00) >>> 0
  return `${[24, 16, 8, 0].map((s) => (base >>> s) & 0xff).join('.')}/24`
}

function groupLabel(node: Node<NodeData>, mode: Exclude<AutoLayoutMode, 'hierarchy'>): string | null {
  return mode === 'type' ? typeGroupLabel(node.data.type) : subnetGroupLabel(node.data.ip)
}

function compareLabels(mode: Exclude<AutoLayoutMode, 'hierarchy'>) {
  if (mode === 'subnet') {
    return (a: string, b: string) => (ipToInt(a.split('/')[0]) ?? 0) - (ipToInt(b.split('/')[0]) ?? 0)
  }
  const rank = (l: string) => {
    const i = TYPE_ORDER.indexOf(l)
    return i === -1 ? TYPE_ORDER.length : i
  }
  return (a: string, b: string) => rank(a) - rank(b)
}

function boxOf(n: Node<NodeData>): { w: number; h: number } {
  return {
    w: n.width ?? n.measured?.width ?? DEFAULT_BOX_W,
    h: n.height ?? n.measured?.height ?? DEFAULT_BOX_H,
  }
}

const sameLabel = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

export interface ZoneGroupingResult {
  nodes: Node<NodeData>[]
  /** Devices that moved into a zone. */
  moved: number
  /** Zones that did not exist before. */
  zonesCreated: number
}

/**
 * Sort every free device into a zone, by family or by /24.
 *
 * "Free" is the rule the zone subnet import runs on: top level (a node already
 * nested in a zone, a group or a container host keeps the parent the user gave
 * it) and not canvas furniture. In subnet mode a device with no IPv4 address
 * stays loose. A top-level zone already carrying the group's label is reused,
 * so a second run fills the same zones instead of stacking duplicates; its
 * current contents stay where they are and arrivals go in below them.
 *
 * Arrivals are packed on shelves at their real size, so a Proxmox host with its
 * VMs gets the room it needs. Zones grow to fit and never shrink. Positions of
 * the zones themselves are left to the Dagre pass that follows.
 */
export function groupIntoZones(
  nodes: Node<NodeData>[],
  mode: Exclude<AutoLayoutMode, 'hierarchy'>,
  newId: () => string = generateUUID,
): ZoneGroupingResult {
  const groups = new Map<string, Node<NodeData>[]>()
  for (const n of nodes) {
    if (n.parentId || FURNITURE_TYPES.has(n.data.type)) continue
    const label = groupLabel(n, mode)
    if (!label) continue
    if (!groups.has(label)) groups.set(label, [])
    groups.get(label)!.push(n)
  }
  if (groups.size === 0) return { nodes, moved: 0, zonesCreated: 0 }

  const zonesByLabel = nodes.filter((n) => n.data.type === 'groupRect' && !n.parentId)
  const updates = new Map<string, Node<NodeData>>()
  const created: Node<NodeData>[] = []
  let moved = 0

  for (const label of [...groups.keys()].sort(compareLabels(mode))) {
    const members = groups.get(label)!
    const existing = zonesByLabel.find((z) => sameLabel(z.data.label ?? '', label))
    const zoneId = existing?.id ?? newId()
    const zoneW = existing ? (existing.width ?? existing.measured?.width ?? ZONE_MIN_WIDTH) : ZONE_MIN_WIDTH
    const zoneH = existing ? (existing.height ?? existing.measured?.height ?? ZONE_MIN_HEIGHT) : ZONE_MIN_HEIGHT

    // Arrivals start under whatever the zone already holds.
    let y = PAD_TOP
    for (const child of nodes) {
      if (child.parentId !== zoneId) continue
      y = Math.max(y, child.position.y + boxOf(child).h + GAP)
    }

    // Shelf packing: a row is as wide as the zone (or MAX_COLUMNS default boxes
    // for a new zone, whichever is wider), as tall as its tallest box.
    const columns = Math.min(MAX_COLUMNS, Math.ceil(Math.sqrt(members.length)))
    const rowWidth = Math.max(zoneW - 2 * PAD_X, columns * (DEFAULT_BOX_W + GAP) - GAP)
    let x = PAD_X
    let rowH = 0
    let right = 0
    for (const m of members) {
      const { w, h } = boxOf(m)
      if (x > PAD_X && x + w > PAD_X + rowWidth) {
        x = PAD_X
        y += rowH + GAP
        rowH = 0
      }
      updates.set(m.id, {
        ...m,
        parentId: zoneId,
        extent: undefined,
        position: { x, y },
        selected: false,
        data: { ...m.data, parent_id: zoneId },
      })
      right = Math.max(right, x + w)
      rowH = Math.max(rowH, h)
      x += w + GAP
      moved += 1
    }

    const width = Math.max(zoneW, right + PAD_X)
    const height = Math.max(zoneH, y + rowH + PAD_BOTTOM)
    if (existing) {
      if (width !== zoneW || height !== zoneH) updates.set(existing.id, { ...existing, width, height })
    } else {
      created.push({
        id: zoneId,
        type: 'groupRect',
        position: { x: 0, y: 0 },
        data: {
          label,
          type: 'groupRect',
          status: 'unknown',
          services: [],
          custom_colors: { z_order: 1 },
        } as NodeData,
        width,
        height,
        // Same stacking as a zone drawn by hand at the default z-order.
        zIndex: 1 - 10,
      })
    }
  }

  return {
    nodes: [...created, ...nodes.map((n) => updates.get(n.id) ?? n)],
    moved,
    zonesCreated: created.length,
  }
}

/**
 * Edges re-pointed at the top-level box each endpoint lives in, for layout only.
 * Dagre sees top-level nodes alone, so without this a zone full of VMs wired to
 * a router would float free of it. Self-loops (both ends in one box) are
 * dropped, duplicates collapsed, and a lifted end loses its handle, which named
 * a port on the child, not on the box.
 */
export function liftEdgesToTopLevel(nodes: Node<NodeData>[], edges: Edge<EdgeData>[]): Edge<EdgeData>[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const topOf = (id: string): string | null => {
    let cur = byId.get(id)
    const seen = new Set<string>()
    while (cur?.parentId && !seen.has(cur.id)) {
      seen.add(cur.id)
      cur = byId.get(cur.parentId)
    }
    return cur?.id ?? null
  }

  const out: Edge<EdgeData>[] = []
  const pairs = new Set<string>()
  for (const e of edges) {
    const s = topOf(e.source)
    const t = topOf(e.target)
    if (!s || !t || s === t) continue
    const key = `${s}\u0000${t}`
    if (pairs.has(key)) continue
    pairs.add(key)
    out.push({
      ...e,
      source: s,
      target: t,
      sourceHandle: s === e.source ? e.sourceHandle : null,
      targetHandle: t === e.target ? e.targetHandle : null,
    })
  }
  return out
}

import type { Node } from '@xyflow/react'

import type { Design, InventoryEntry, NodeData } from '@/types'
import { ipToInt, parseCidr } from '@/utils/subnet'
import type { DocState, DocumentSummary, GroupBy, TreeGroup, TreeLeaf } from './types'

/**
 * The Devices tree, pivoted.
 *
 * Every grouping the user can pick is derivable from data the app has already
 * loaded — the inventory rows, the canvas nodes, the racks — so the tree is
 * built here rather than fetched. Re-pivoting is then instant and there is no
 * server-side tree to keep in sync with the canvas.
 *
 * The Library tree is the opposite: real folders the user files by hand, so it
 * comes straight from `parent_id` and never re-shapes.
 */

const UNGROUPED = 'Ungrouped'

/** Canvas furniture. A zone or a group is a container, not a device. */
const FURNITURE = new Set(['group', 'groupRect', 'text'])

/** Types that are a guest rather than a box you can touch. */
const VIRTUAL_TYPES = new Set(['vm', 'lxc', 'docker_container'])

/** Types that host guests. Reported separately so the split reads as three. */
const HOST_TYPES = new Set(['proxmox', 'docker_host'])

export type Physicality = 'Physical' | 'Virtual' | 'Host'

/**
 * Physical, virtual, or a host running guests.
 *
 * The type decides it; `container_mode` and having children are the fallback
 * for a device typed generically but drawn as a container.
 */
export function physicality(
  type: string | null | undefined,
  opts: { hasChildren?: boolean; containerMode?: boolean } = {},
): Physicality {
  const t = type ?? ''
  if (VIRTUAL_TYPES.has(t)) return 'Virtual'
  if (HOST_TYPES.has(t)) return 'Host'
  if (opts.containerMode || opts.hasChildren) return 'Host'
  return 'Physical'
}

/** Every IP a device declares. The column is a comma-separated list. */
export function splitIps(ip: string | null | undefined): string[] {
  return (ip ?? '')
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean)
}

/** The /24 an address sits in, for grouping when no CIDR is configured. */
export function slash24(ip: string): string | null {
  if (ipToInt(ip) === null) return null
  const octets = ip.split('.')
  return `${octets[0]}.${octets[1]}.${octets[2]}.0/24`
}

/**
 * Which of the configured ranges an address falls in, else its own /24.
 * A device declaring several addresses lands under each of their subnets.
 */
export function subnetsOf(device: InventoryEntry, ranges: string[]): string[] {
  const found = new Set<string>()
  for (const ip of splitIps(device.ip)) {
    const value = ipToInt(ip)
    if (value === null) continue
    const match = ranges.find((cidr) => {
      const parsed = parseCidr(cidr)
      if (!parsed) return false
      const mask = parsed.bits === 0 ? 0 : (-1 << (32 - parsed.bits)) >>> 0
      return ((value & mask) >>> 0) === parsed.base
    })
    const subnet = match ?? slash24(ip)
    if (subnet) found.add(subnet)
  }
  return found.size ? [...found] : [UNGROUPED]
}

export interface DeviceContext {
  /**
   * Nodes of the canvas that is currently loaded. The app only ever holds one
   * canvas at a time, so the "Canvas" pivot answers "on this one or not"
   * rather than naming every canvas a device appears on.
   */
  nodes: Node<NodeData>[]
  designs: Design[]
  /** The design those nodes belong to. */
  activeDesignId?: string | null
  /** deviceId → rack name, from the rack store when a rack canvas is loaded. */
  racksByDevice?: Record<string, string>
  /** CIDRs from the scan settings; falls back to a per-address /24. */
  ranges?: string[]
}

interface NodeFacts {
  zone?: string
  group?: string
  canvas?: string
  hasChildren: boolean
  containerMode: boolean
  type?: string
}

/**
 * What the canvas knows about each device: the containers it sits in and the
 * canvas it is drawn on. A device drawn twice keeps the first placement per
 * grouping, so it appears once under each distinct answer.
 */
export function nodeFactsByDevice(context: DeviceContext): Record<string, NodeFacts> {
  const byId = new Map(context.nodes.map((n) => [n.id, n]))
  const designName = new Map(context.designs.map((d) => [d.id, d.name]))
  const parentOf = new Map<string, string>()
  for (const node of context.nodes) {
    if (node.data.parent_id) parentOf.set(node.id, node.data.parent_id)
  }
  const hasChildren = new Set([...parentOf.values()])

  const facts: Record<string, NodeFacts> = {}
  for (const node of context.nodes) {
    const deviceId = node.data.device_id
    if (!deviceId || FURNITURE.has(node.data.type)) continue
    const entry: NodeFacts = facts[deviceId] ?? {
      hasChildren: hasChildren.has(node.id),
      containerMode: node.data.container_mode === true,
      type: node.data.type,
    }
    // Walk up to the nearest zone and the nearest group; they are different
    // containers and a node can sit in one, the other, or both.
    const seen = new Set<string>()
    let cursor = node.data.parent_id
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor)
      const parent = byId.get(cursor)
      if (!parent) break
      if (parent.data.type === 'groupRect' && !entry.zone) entry.zone = parent.data.label
      if (parent.data.type === 'group' && !entry.group) entry.group = parent.data.label
      cursor = parent.data.parent_id
    }
    if (!entry.canvas && context.activeDesignId) {
      entry.canvas = designName.get(context.activeDesignId)
    }
    facts[deviceId] = entry
  }
  return facts
}

/** The buckets one device belongs to under a given pivot. Usually exactly one. */
export function bucketsFor(
  device: InventoryEntry,
  groupBy: GroupBy,
  facts: NodeFacts | undefined,
  doc: DocumentSummary | undefined,
  context: DeviceContext,
): string[] {
  switch (groupBy) {
    case 'zone':
      return [facts?.zone || 'Unzoned']
    case 'group':
      return [facts?.group || 'Ungrouped']
    case 'type':
      return [device.type || device.suggested_type || 'Untyped']
    case 'physicality':
      return [
        physicality(device.type || device.suggested_type || facts?.type, {
          hasChildren: facts?.hasChildren,
          containerMode: facts?.containerMode,
        }),
      ]
    case 'subnet':
      return subnetsOf(device, context.ranges ?? [])
    case 'canvas':
      return [facts?.canvas || 'Not on this canvas']
    case 'rack':
      return [context.racksByDevice?.[device.id] || 'Not racked']
    case 'vendor':
      return [device.vendor || 'Unknown vendor']
    case 'source': {
      const sources = device.discovery_sources?.length
        ? device.discovery_sources
        : [device.discovery_source].filter(Boolean)
      return sources.length ? (sources as string[]) : [UNGROUPED]
    }
    case 'status':
      return [device.status_live || 'unknown']
    case 'tag':
      return doc?.tags?.length ? doc.tags : ['Untagged']
    case 'flat':
    default:
      return ['All devices']
  }
}

/** What the badge next to a device says. */
export function docState(
  doc: DocumentSummary | undefined,
  opts: { drifted?: boolean; overdue?: boolean } = {},
): DocState {
  if (!doc) return 'none'
  if (opts.drifted) return 'drifted'
  if (opts.overdue) return 'overdue'
  return doc.edited_at ? 'written' : 'header-only'
}

export function deviceLabel(device: InventoryEntry): string {
  return device.label || device.friendly_name || device.hostname || device.ip || 'Unnamed device'
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** Groups last-resort buckets to the bottom, everything else alphabetically. */
function compareGroups(a: TreeGroup, b: TreeGroup): number {
  const trailing = new Set(['Unzoned', 'Ungrouped', 'Untyped', 'Untagged', 'Not racked', 'Not on this canvas', 'Unknown vendor', UNGROUPED])
  const aLast = trailing.has(a.label)
  const bLast = trailing.has(b.label)
  if (aLast !== bLast) return aLast ? 1 : -1
  return collator.compare(a.label, b.label)
}

export interface DeviceTreeOptions {
  groupBy: GroupBy
  devices: InventoryEntry[]
  docs: DocumentSummary[]
  context: DeviceContext
  /** Document ids the coverage pass flagged. */
  drifted?: Set<string>
  overdue?: Set<string>
}

/** The Devices root, grouped as asked. */
export function buildDeviceTree(options: DeviceTreeOptions): TreeGroup[] {
  const { groupBy, devices, docs, context } = options
  const docByDevice = new Map(docs.filter((d) => d.device_id).map((d) => [d.device_id as string, d]))
  const facts = nodeFactsByDevice(context)

  const groups = new Map<string, TreeLeaf[]>()
  for (const device of devices) {
    const doc = docByDevice.get(device.id)
    const leaf: TreeLeaf = {
      id: doc?.id ?? `device:${device.id}`,
      label: deviceLabel(device),
      docId: doc?.id,
      deviceId: device.id,
      kind: doc ? 'device' : 'device-without-doc',
      state: docState(doc, {
        drifted: doc ? options.drifted?.has(doc.id) : false,
        overdue: doc ? options.overdue?.has(doc.id) : false,
      }),
    }
    for (const bucket of bucketsFor(device, groupBy, facts[device.id], doc, context)) {
      const items = groups.get(bucket) ?? []
      items.push(leaf)
      groups.set(bucket, items)
    }
  }

  return [...groups.entries()]
    .map(([label, items]) => ({
      key: `${groupBy}:${label}`,
      label,
      items: items.sort((a, b) => collator.compare(a.label, b.label)),
    }))
    .sort(compareGroups)
}

/** The Library root: real folders, nested by `parent_id`. */
export function buildLibraryTree(docs: DocumentSummary[]): TreeLeaf[] {
  const tree = docs.filter((d) => d.kind === 'page' || d.kind === 'folder')
  const byParent = new Map<string | null, DocumentSummary[]>()
  for (const doc of tree) {
    const key = doc.parent_id ?? null
    byParent.set(key, [...(byParent.get(key) ?? []), doc])
  }

  const seen = new Set<string>()
  const build = (parentId: string | null): TreeLeaf[] =>
    (byParent.get(parentId) ?? [])
      .filter((doc) => !seen.has(doc.id))
      .sort((a, b) => a.sort_order - b.sort_order || collator.compare(a.title, b.title))
      .map((doc): TreeLeaf => {
        // A cycle would recurse forever; a folder can only be built once.
        seen.add(doc.id)
        return {
          id: doc.id,
          label: doc.title,
          docId: doc.id,
          kind: doc.kind,
          state: docState(doc),
          icon: doc.icon,
          children: doc.kind === 'folder' ? build(doc.id) : undefined,
        }
      })

  return build(null)
}

/** Filter a tree by a typed query, keeping the folders that lead to a match. */
export function filterTree(items: TreeLeaf[], query: string): TreeLeaf[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return items
  const walk = (leaves: TreeLeaf[]): TreeLeaf[] =>
    leaves
      .map((leaf): TreeLeaf | null => {
        const children = leaf.children ? walk(leaf.children) : undefined
        const hit = leaf.label.toLowerCase().includes(needle)
        if (!hit && !children?.length) return null
        return { ...leaf, children }
      })
      .filter((leaf): leaf is TreeLeaf => leaf !== null)
  return walk(items)
}

export function filterGroups(groups: TreeGroup[], query: string): TreeGroup[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return groups
  return groups
    .map((group) => ({
      ...group,
      items: group.label.toLowerCase().includes(needle)
        ? group.items
        : group.items.filter((item) => item.label.toLowerCase().includes(needle)),
    }))
    .filter((group) => group.items.length > 0)
}

/** Whether `doc` sits anywhere under `ancestorId`. */
export function isDescendant(
  all: DocumentSummary[],
  doc: DocumentSummary,
  ancestorId: string,
): boolean {
  const byId = new Map(all.map((d) => [d.id, d]))
  const seen = new Set<string>()
  let cursor = doc.parent_id ?? null
  while (cursor && !seen.has(cursor)) {
    if (cursor === ancestorId) return true
    seen.add(cursor)
    cursor = byId.get(cursor)?.parent_id ?? null
  }
  return false
}

/**
 * Whether `doc` can be filed under `targetId` — `null` being the Library root.
 *
 * The server enforces the same four rules; deciding them here too is what lets
 * a drag refuse the drop instead of asking, moving, and then failing.
 */
export function canMoveInto(
  docs: DocumentSummary[],
  doc: DocumentSummary,
  targetId: string | null,
): boolean {
  if (doc.kind !== 'page' && doc.kind !== 'folder') return false
  if ((doc.parent_id ?? null) === targetId) return false
  if (targetId === null) return true
  if (targetId === doc.id) return false
  const target = docs.find((d) => d.id === targetId)
  if (!target || target.kind !== 'folder') return false
  return !isDescendant(docs, target, doc.id)
}

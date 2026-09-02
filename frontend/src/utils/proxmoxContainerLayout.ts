/**
 * Placement for a Proxmox import that nests guests inside their host.
 *
 * Container mode draws the host as a box (`data.container_mode`) and parents its
 * VMs/LXCs to it (React Flow `parentId` + `extent: 'parent'`). `addNode` turns
 * an absolute child position into a parent-relative one by subtracting the
 * parent's position, so every coordinate here is absolute canvas space and the
 * children are already offset by their host.
 *
 * Hosts sit side by side on one row; anything with no host in the selection
 * ("loose") falls back to the plain grid the non-container import uses, placed
 * below the tallest host.
 */

export const CONTAINER_LAYOUT = {
  childWidth: 180,
  childHeight: 52,
  /** Room above the first child row for the host's own header/label. */
  padTop: 60,
  padX: 20,
  padBottom: 20,
  gapX: 16,
  gapY: 14,
  maxCols: 3,
  hostGap: 60,
  /** Same defaults `setProxmoxContainerMode` gives a host with no size yet. */
  minHostWidth: 300,
  minHostHeight: 200,
  looseCols: 4,
  looseSpacingX: 190,
  looseSpacingY: 110,
} as const

export interface XY { x: number; y: number }
export interface Size { width: number; height: number }

export interface ProxmoxContainerLayout {
  /** Absolute canvas position per node id (hosts, nested guests, loose nodes). */
  positions: Record<string, XY>
  /** Box size per host id — what the container needs to hold its guests. */
  hostSizes: Record<string, Size>
}

export function layoutProxmoxContainers(
  hostIds: string[],
  childrenByHost: Record<string, string[]>,
  looseIds: string[],
  origin: XY,
): ProxmoxContainerLayout {
  const C = CONTAINER_LAYOUT
  const positions: Record<string, XY> = {}
  const hostSizes: Record<string, Size> = {}

  let cursorX = origin.x
  let tallestHost = 0

  for (const hostId of hostIds) {
    const children = childrenByHost[hostId] ?? []
    const cols = Math.max(1, Math.min(C.maxCols, children.length))
    const rows = Math.ceil(children.length / cols)
    const width = Math.max(
      C.minHostWidth,
      C.padX * 2 + cols * C.childWidth + (cols - 1) * C.gapX,
    )
    const height = Math.max(
      C.minHostHeight,
      C.padTop + C.padBottom + rows * C.childHeight + Math.max(0, rows - 1) * C.gapY,
    )

    positions[hostId] = { x: cursorX, y: origin.y }
    hostSizes[hostId] = { width, height }

    children.forEach((childId, i) => {
      positions[childId] = {
        x: cursorX + C.padX + (i % cols) * (C.childWidth + C.gapX),
        y: origin.y + C.padTop + Math.floor(i / cols) * (C.childHeight + C.gapY),
      }
    })

    cursorX += width + C.hostGap
    tallestHost = Math.max(tallestHost, height)
  }

  const looseY = origin.y + (hostIds.length > 0 ? tallestHost + C.hostGap : 0)
  looseIds.forEach((id, i) => {
    positions[id] = {
      x: origin.x + (i % C.looseCols) * C.looseSpacingX,
      y: looseY + Math.floor(i / C.looseCols) * C.looseSpacingY,
    }
  })

  return { positions, hostSizes }
}

/**
 * Total bounding size of the layout, so a caller can centre it in the viewport
 * before it knows any coordinate (`getCenteredPosition(w, h)`).
 */
export function measureProxmoxContainers(
  hostIds: string[],
  childrenByHost: Record<string, string[]>,
  looseCount: number,
): Size {
  const { positions, hostSizes } = layoutProxmoxContainers(
    hostIds,
    childrenByHost,
    Array.from({ length: looseCount }, (_, i) => `__loose-${i}`),
    { x: 0, y: 0 },
  )
  let width = 0
  let height = 0
  for (const [id, pos] of Object.entries(positions)) {
    const size = hostSizes[id]
    width = Math.max(width, pos.x + (size?.width ?? CONTAINER_LAYOUT.childWidth))
    height = Math.max(height, pos.y + (size?.height ?? CONTAINER_LAYOUT.childHeight))
  }
  return { width, height }
}

export interface GuestGrouping {
  /** Host node ids, in the order they were given. */
  hostIds: string[]
  /** Guest node ids per host, in edge order. */
  childrenByHost: Record<string, string[]>
  /** Host id each guest belongs to. */
  hostOfChild: Record<string, string>
  /** Selected ids that are neither a host nor a guest of a selected host. */
  looseIds: string[]
}

/**
 * Split a Proxmox selection into hosts, their guests and everything left over.
 *
 * A guest reaches at most one host: a second edge naming it is ignored rather
 * than moving it, since React Flow gives a node one parent. Edges pointing
 * outside the selection, or from host to host (a cluster link), are skipped.
 */
export function groupProxmoxGuests(
  nodes: { id: string; type: string }[],
  edges: { source: string; target: string }[],
): GuestGrouping {
  const selected = new Set(nodes.map((n) => n.id))
  const hostIds = nodes.filter((n) => n.type === 'proxmox').map((n) => n.id)
  const hostIdSet = new Set(hostIds)
  const childrenByHost: Record<string, string[]> = {}
  const hostOfChild: Record<string, string> = {}
  hostIds.forEach((id) => { childrenByHost[id] = [] })

  for (const e of edges) {
    if (!hostIdSet.has(e.source) || !selected.has(e.target)) continue
    if (hostIdSet.has(e.target) || hostOfChild[e.target]) continue
    childrenByHost[e.source].push(e.target)
    hostOfChild[e.target] = e.source
  }

  const looseIds = nodes
    .filter((n) => !hostIdSet.has(n.id) && !hostOfChild[n.id])
    .map((n) => n.id)

  return { hostIds, childrenByHost, hostOfChild, looseIds }
}

/**
 * Reads the links already drawn on the logical canvases, so a fresh rack can be
 * seeded with the patches the user has already documented.
 *
 * Endpoints are canvas node ids, matched against `RackDevice.nodeId` — a mount
 * only carries one when its inventory entry resolves to a node.
 */
import { canvasApi } from '@/api/client'
import type { CableType, Design } from '@/types'
import type { NetworkLinkHint } from './store'

interface ApiEdgeLike {
  source: string
  target: string
  type?: string
  label?: string | null
}

/** Edge types worth turning into a physical patch. */
const PHYSICAL_EDGE_TYPES = new Set(['ethernet', 'fibre', 'vlan', 'cluster'])

function toCableType(edgeType: string | undefined): CableType {
  return edgeType === 'fibre' ? 'fiber' : 'ethernet'
}

/**
 * Collect physical links across every non-rack design.
 *
 * Best-effort: a design that fails to load is skipped rather than failing the
 * whole import, since this only ever seeds an optional starting point.
 */
export async function loadNetworkLinks(designs: Design[]): Promise<NetworkLinkHint[]> {
  const sources = designs.filter((d) => d.design_type !== 'rack')
  const hints: NetworkLinkHint[] = []
  const seen = new Set<string>()

  for (const design of sources) {
    let edges: ApiEdgeLike[] = []
    try {
      const res = await canvasApi.load(design.id)
      edges = ((res.data as { edges?: ApiEdgeLike[] })?.edges ?? [])
    } catch {
      continue
    }
    for (const edge of edges) {
      if (edge.type && !PHYSICAL_EDGE_TYPES.has(edge.type)) continue
      // Node ids are unique across designs, so an unordered pair dedupes links
      // that the user drew on more than one canvas.
      const key = [edge.source, edge.target].sort().join('|')
      if (seen.has(key)) continue
      seen.add(key)
      hints.push({
        from: edge.source,
        to: edge.target,
        type: toCableType(edge.type),
        label: edge.label ?? undefined,
      })
    }
  }
  return hints
}

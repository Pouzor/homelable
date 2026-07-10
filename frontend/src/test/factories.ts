/**
 * Canonical test fixture builders. Prefer these over redefining `makeNode` /
 * `makeEdge` inline per test file — one source of truth keeps fixtures in sync
 * with the domain types.
 *
 * See CLAUDE.md → Testing Protocol.
 */
import type { Node, Edge } from '@xyflow/react'
import type { NodeData, EdgeData, Design } from '@/types'

/** Build a `NodeData` payload with sane defaults; override any field. */
export function makeNodeData(overrides: Partial<NodeData> = {}): NodeData {
  return {
    label: overrides.label ?? 'Test Node',
    type: 'server',
    status: 'unknown',
    services: [],
    ...overrides,
  }
}

/**
 * Build a React Flow node. Accepts either an id string or a partial-node
 * object as the first arg, so it covers both inline patterns that existed
 * across the suite:
 *   makeNode('n1', { type: 'router' })
 *   makeNode({ data: makeNodeData({ ip: '10.0.0.1' }) })
 */
export function makeNode(
  idOrOverrides: string | Partial<Node<NodeData>> = 'n1',
  dataOverrides: Partial<NodeData> = {},
): Node<NodeData> {
  const base: Partial<Node<NodeData>> =
    typeof idOrOverrides === 'string' ? { id: idOrOverrides } : idOrOverrides
  const id = base.id ?? 'n1'
  return {
    id,
    type: base.type ?? base.data?.type ?? dataOverrides.type ?? 'server',
    position: base.position ?? { x: 0, y: 0 },
    ...base,
    data: makeNodeData({ label: id, ...dataOverrides, ...base.data }),
  }
}

/** Build a React Flow edge between two node ids. */
export function makeEdge(
  id: string,
  source: string,
  target: string,
  overrides: Partial<Edge<EdgeData>> = {},
): Edge<EdgeData> {
  return {
    id,
    source,
    target,
    type: 'ethernet',
    ...overrides,
    data: { type: 'ethernet', ...overrides.data },
  }
}

/** Build a Design row. */
export function makeDesign(overrides: Partial<Design> = {}): Design {
  return {
    id: 'd1',
    name: 'Test Design',
    design_type: 'network',
    icon: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

/**
 * A document either lives in the Library tree (`page`, `folder`) or describes
 * exactly one thing elsewhere in the app (`device`, `node`, `design`).
 *
 * Kept in sync with DOCUMENT_KINDS in `backend/app/services/doc_tree.py`.
 */
export type DocKind = 'device' | 'node' | 'design' | 'page' | 'folder'

/** Kinds the user files by hand. Everything else is placed by its link. */
export const TREE_KINDS: readonly DocKind[] = ['page', 'folder']

export interface DocumentSummary {
  id: string
  kind: DocKind
  title: string
  slug: string
  icon?: string | null
  parent_id?: string | null
  sort_order: number
  device_id?: string | null
  node_id?: string | null
  design_id?: string | null
  tags: string[]
  /** The parsed frontmatter, so the tree can badge without loading bodies. */
  frontmatter: Record<string, unknown>
  starred: boolean
  template_id?: string | null
  reviewed_at?: string | null
  edited_at?: string | null
  facts_synced_at?: string | null
  created_at: string
  updated_at: string
}

export interface Doc extends DocumentSummary {
  body: string
  facts_snapshot?: Record<string, unknown> | null
}

export interface DocRevision {
  id: string
  document_id: string
  title: string
  reason: 'edit' | 'restore' | 'import' | 'migrate' | 'scaffold'
  saved_at: string
  size: number
}

export interface DocSearchHit {
  doc_id: string
  title: string
  kind: DocKind
  snippet: string
  device_id?: string | null
}

export interface DocSearchResult {
  /** "like" means no FTS5 — the UI drops snippet highlighting. */
  engine: 'fts5' | 'like'
  hits: DocSearchHit[]
}

export interface DocCoverage {
  devices: number
  documented: number
  header_only: number
  missing: number
  drifted: number
  overdue: number
  notes_unmigrated: number
  library_pages: number
}

/** Templates the "New document" menu offers. Mirrors `doc_template.py`. */
export const DOC_TEMPLATES = [
  { id: 'blank', label: 'Blank page', hint: 'A title and nothing else' },
  { id: 'runbook', label: 'Runbook', hint: 'Trigger, steps, rollback' },
  { id: 'service', label: 'Service', hint: 'A service spanning hosts' },
  { id: 'network', label: 'Network overview', hint: 'Topology, subnets, routing' },
  { id: 'incident', label: 'Incident', hint: 'Timeline, cause, fix' },
  { id: 'procedure', label: 'Procedure', hint: 'Goal, prerequisites, steps' },
  { id: 'decision', label: 'Decision (ADR)', hint: 'Context, decision, consequences' },
  { id: 'zone', label: 'Zone / group', hint: 'Purpose, members, addressing' },
] as const

export type DocTemplateId = (typeof DOC_TEMPLATES)[number]['id']

/** How the Devices root is pivoted. The Library tree never changes shape. */
export type GroupBy =
  | 'zone'
  | 'group'
  | 'type'
  | 'physicality'
  | 'subnet'
  | 'canvas'
  | 'rack'
  | 'vendor'
  | 'source'
  | 'status'
  | 'tag'
  | 'flat'

export const GROUP_BY_LABELS: Record<GroupBy, string> = {
  zone: 'Zone',
  group: 'Group',
  type: 'Type',
  physicality: 'Physical / virtual',
  subnet: 'Subnet',
  canvas: 'Canvas',
  rack: 'Rack',
  vendor: 'Vendor',
  source: 'Discovery source',
  status: 'Status',
  tag: 'Tag',
  flat: 'A–Z',
}

/** What the tree badge says about a device at a glance. */
export type DocState = 'none' | 'header-only' | 'written' | 'drifted' | 'overdue'

export interface TreeLeaf {
  id: string
  label: string
  docId?: string
  deviceId?: string
  nodeId?: string
  kind: DocKind | 'device-without-doc'
  state: DocState
  icon?: string | null
  children?: TreeLeaf[]
}

export interface TreeGroup {
  key: string
  label: string
  items: TreeLeaf[]
}

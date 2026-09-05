/**
 * `[[device:nas-01]]`, `[[doc:vlan-plan]]` and bare `[[VLAN plan]]`.
 *
 * Parsed as a plain text pass rather than a remark plugin: the syntax is one
 * token with no nesting, and keeping it out of the AST pipeline means the
 * markdown stays ordinary markdown for anything that reads the file elsewhere.
 */

export type WikiTarget = 'device' | 'doc' | 'node'

export interface WikiLink {
  target: WikiTarget
  /** What was written after the colon, or the whole label for a bare link. */
  key: string
  /** The text to show; the part after `|`, else the key. */
  label: string
  raw: string
}

const LINK = /\[\[([^\]]+)\]\]/g

export function parseWikiLink(inner: string): WikiLink | null {
  const [addressPart, labelPart] = inner.split('|', 2).map((part) => part.trim())
  if (!addressPart) return null
  const colon = addressPart.indexOf(':')
  let target: WikiTarget = 'doc'
  let key = addressPart
  if (colon > 0) {
    const prefix = addressPart.slice(0, colon).toLowerCase()
    if (prefix === 'device' || prefix === 'doc' || prefix === 'node') {
      target = prefix
      key = addressPart.slice(colon + 1).trim()
    }
  }
  if (!key) return null
  return { target, key, label: labelPart || key, raw: `[[${inner}]]` }
}

export type Segment = { type: 'text'; value: string } | { type: 'link'; link: WikiLink }

/** Split a string into plain text and wiki-link segments, in order. */
export function splitWikiLinks(text: string): Segment[] {
  const segments: Segment[] = []
  let cursor = 0
  LINK.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = LINK.exec(text)) !== null) {
    const link = parseWikiLink(match[1])
    if (!link) continue
    if (match.index > cursor) segments.push({ type: 'text', value: text.slice(cursor, match.index) })
    segments.push({ type: 'link', link })
    cursor = match.index + match[0].length
  }
  if (cursor < text.length) segments.push({ type: 'text', value: text.slice(cursor) })
  return segments
}

/** Every wiki-link in a body, for the backlinks index. */
export function collectWikiLinks(body: string): WikiLink[] {
  const found: WikiLink[] = []
  LINK.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = LINK.exec(body)) !== null) {
    const link = parseWikiLink(match[1])
    if (link) found.push(link)
  }
  return found
}

export interface LinkableDoc {
  id: string
  slug: string
  title: string
  device_id?: string | null
  node_id?: string | null
}

export interface LinkableDevice {
  id: string
  label: string
}

/** Resolve a link to a document id, or null when nothing matches yet. */
export function resolveWikiLink(
  link: WikiLink,
  docs: LinkableDoc[],
  devices: LinkableDevice[] = [],
): string | null {
  const key = link.key.toLowerCase()
  if (link.target === 'device') {
    const device = devices.find(
      (d) => d.id === link.key || d.label.toLowerCase() === key,
    )
    if (!device) return null
    return docs.find((doc) => doc.device_id === device.id)?.id ?? null
  }
  if (link.target === 'node') {
    return docs.find((doc) => doc.node_id === link.key)?.id ?? null
  }
  return (
    docs.find((doc) => doc.id === link.key)?.id ??
    docs.find((doc) => doc.slug.toLowerCase() === key)?.id ??
    docs.find((doc) => doc.title.toLowerCase() === key)?.id ??
    null
  )
}

/** doc id → the documents that link to it. */
export function backlinkIndex(
  docs: (LinkableDoc & { body: string })[],
  devices: LinkableDevice[] = [],
): Record<string, string[]> {
  const index: Record<string, string[]> = {}
  for (const doc of docs) {
    for (const link of collectWikiLinks(doc.body)) {
      const targetId = resolveWikiLink(link, docs, devices)
      if (!targetId || targetId === doc.id) continue
      const current = index[targetId] ?? []
      if (!current.includes(doc.id)) index[targetId] = [...current, doc.id]
    }
  }
  return index
}

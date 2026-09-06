import yaml from 'js-yaml'

/**
 * The YAML block at the top of a document body.
 *
 * The body is the source of truth — it is what exports to disk — so nothing
 * here ever writes the parsed object back on its own. Malformed YAML is not an
 * error: the user is mid-edit, and the metadata simply reads empty until the
 * block parses again.
 */

// `[ \t]*`, not `\s*`: `\s` matches the newline the fence line ends with, so the
// same position is reachable two ways and the match goes quadratic on a body
// that opens with `---` and never closes it — which is what a document looks
// like for as long as the user is still typing the block.
const BLOCK = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/

export interface Frontmatter {
  data: Record<string, unknown>
  /** The body with the block removed, for rendering. */
  content: string
}

export function parseFrontmatter(body: string): Frontmatter {
  const match = BLOCK.exec(body ?? '')
  if (!match) return { data: {}, content: body ?? '' }
  let data: Record<string, unknown> = {}
  try {
    const parsed = yaml.load(match[1])
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      data = parsed as Record<string, unknown>
    }
  } catch {
    // Mid-edit YAML. The document still renders; only the metadata is missing.
  }
  return { data, content: (body ?? '').slice(match[0].length) }
}

export function tagsOf(data: Record<string, unknown>): string[] {
  const raw = data.tags
  if (typeof raw === 'string') return raw.split(',').map((t) => t.trim()).filter(Boolean)
  if (!Array.isArray(raw)) return []
  return raw.map((t) => String(t).trim()).filter(Boolean)
}

/** A tag needs quoting when flow style would read it as YAML syntax. */
function tagLiteral(tag: string): string {
  return /[[\]{},:#&*!|>'"%@`]|^\s|\s$/.test(tag) ? JSON.stringify(tag) : tag
}

/**
 * Rewrite only the `tags:` entry of the block, leaving every other line byte
 * for byte as the user wrote it.
 *
 * `withFrontmatter` would round-trip the whole block through the YAML dumper,
 * which reformats what it did not need to touch — `created: 2026-09-07` comes
 * back as a full timestamp, because that is what the date parsed to. Editing a
 * tag should not rewrite a date.
 */
export function withTags(body: string, tags: string[]): string {
  const line = `tags: [${tags.map(tagLiteral).join(', ')}]`
  const match = BLOCK.exec(body ?? '')
  if (!match) return `---\n${line}\n---\n\n${body ?? ''}`
  const lines = match[1].split('\n')
  const at = lines.findIndex((entry) => /^tags[ \t]*:/.test(entry))
  if (at === -1) {
    lines.push(line)
  } else {
    // The key alone when it was written inline; the key and its items when it
    // was written as a block list.
    let end = at + 1
    while (end < lines.length && /^[ \t]*-[ \t]/.test(lines[end])) end += 1
    lines.splice(at, end - at, line)
  }
  return `---\n${lines.join('\n')}\n---\n${(body ?? '').slice(match[0].length)}`
}

/** Replace the frontmatter block, or add one when the body has none. */
export function withFrontmatter(body: string, data: Record<string, unknown>): string {
  const block = `---\n${yaml.dump(data, { lineWidth: 120 }).trimEnd()}\n---\n`
  const match = BLOCK.exec(body ?? '')
  return match ? block + (body ?? '').slice(match[0].length) : `${block}\n${body ?? ''}`
}

const INTERVAL = /^\s*(\d+)\s*([dwmy])\s*$/i
const INTERVAL_DAYS: Record<string, number> = { d: 1, w: 7, m: 30, y: 365 }

/** `6m` → 180 days in ms. Anything unparseable means "never due". */
export function reviewInterval(raw: unknown): number | null {
  const match = INTERVAL.exec(String(raw ?? ''))
  if (!match) return null
  return Number(match[1]) * INTERVAL_DAYS[match[2].toLowerCase()] * 24 * 60 * 60 * 1000
}

export function isOverdue(
  data: Record<string, unknown>,
  reviewedAt: string | null | undefined,
  createdAt: string,
  now = Date.now(),
): boolean {
  const interval = reviewInterval(data.review_every)
  if (interval === null) return false
  const since = Date.parse(reviewedAt || createdAt)
  return Number.isFinite(since) && now - since > interval
}

/** The one-line summary shown on a card: the first blockquote or paragraph. */
export function summaryOf(body: string, limit = 160): string {
  const { content } = parseFrontmatter(body)
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || line.startsWith('<!--')) continue
    const withoutQuote = line.replace(/^>\s?/, '').trim()
    // A generated prompt is not a summary — it is the absence of one. Checked
    // before the emphasis is stripped, since the underscores are the marker.
    if (/^[_*].*[_*]$/.test(withoutQuote)) continue
    const text = withoutQuote.replace(/[*_`]/g, '').trim()
    if (!text) continue
    return text.length > limit ? `${text.slice(0, limit - 1)}…` : text
  }
  return ''
}

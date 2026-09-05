/**
 * Headings for the "On this page" rail.
 *
 * Read from the markdown source rather than the DOM so the rail renders with
 * the document instead of one paint later, and so it works in tests. Slugs
 * match `rehype-slug`'s GitHub algorithm — lowercase, punctuation dropped,
 * spaces to dashes, duplicates suffixed — because that is what the rendered
 * anchors carry.
 */

export interface TocEntry {
  id: string
  text: string
  level: number
}

const HEADING = /^(#{1,4})\s+(.+?)\s*#*\s*$/
const FENCE = /^\s*(```|~~~)/

export function slugifyHeading(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    // Each whitespace character becomes its own dash — github-slugger does not
    // collapse runs, so "Start / stop" anchors as "start--stop".
    .replace(/\s/g, '-')
}

/** Strip the inline markup a heading may carry before it becomes a label. */
export function headingText(raw: string): string {
  return raw
    .replace(/\[\[([^\]]+)\]\]/g, (_, inner: string) => inner.split('|').pop()?.trim() ?? inner)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '')
    .trim()
}

export function extractToc(body: string, minLevel = 2, maxLevel = 3): TocEntry[] {
  const entries: TocEntry[] = []
  const used = new Map<string, number>()
  let inFence = false

  for (const line of (body ?? '').split('\n')) {
    if (FENCE.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const match = HEADING.exec(line)
    if (!match) continue
    const level = match[1].length
    if (level < minLevel || level > maxLevel) continue
    const text = headingText(match[2])
    if (!text) continue
    const base = slugifyHeading(text)
    const seen = used.get(base) ?? 0
    used.set(base, seen + 1)
    entries.push({ id: seen === 0 ? base : `${base}-${seen}`, text, level })
  }
  return entries
}

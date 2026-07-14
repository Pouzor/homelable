/**
 * Fuzzy-match a node label against a list of dashboard-icons slugs.
 *
 * Confidence levels:
 *   'exact'   — normalized label equals normalized slug base (no -dark/-light)
 *   'high'    — one is a prefix of the other, or all label tokens appear in slug
 *   'partial' — at least one shared token with a reasonably close slug
 *
 * Always prefers the plain slug over -dark / -light variants.
 */

export type MatchConfidence = 'exact' | 'high' | 'partial'

export interface IconMatch {
  slug: string
  confidence: MatchConfidence
}

/** Strip -dark / -light suffix so we compare base names. */
function slugBase(slug: string): string {
  return slug.replace(/-(dark|light)$/, '')
}

/** Expand camelCase and normalize to lowercase space-separated tokens. */
function normalize(s: string): string {
  return s
    .replace(/([a-z])([A-Z])/g, '$1 $2') // camelCase → spaces
    .toLowerCase()
    .replace(/[-_./\\]+/g, ' ')           // dashes, underscores, dots → spaces
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenize(s: string): string[] {
  return normalize(s).split(' ').filter(Boolean)
}

/**
 * Returns the best brand-icon slug for a given label, or null if no
 * confident match exists. Ignores -dark/-light variants (prefers the plain
 * base slug). Slugs list is the raw array from dashboardIcons.json.
 */
export function matchBrandIcon(label: string, slugs: string[]): IconMatch | null {
  if (!label.trim()) return null

  const normLabel = normalize(label)
  const labelTokens = tokenize(label)

  // Build index: normalized-base → preferred slug (plain > dark > light)
  const baseIndex = new Map<string, string>()
  for (const slug of slugs) {
    const base = slugBase(slug)
    const normBase = normalize(base)
    if (!baseIndex.has(normBase)) {
      baseIndex.set(normBase, slug)
    } else {
      // Plain slug is preferred over -dark/-light variants
      const existing = baseIndex.get(normBase)!
      const existingIsVariant = existing.endsWith('-dark') || existing.endsWith('-light')
      const currentIsVariant = slug.endsWith('-dark') || slug.endsWith('-light')
      if (existingIsVariant && !currentIsVariant) baseIndex.set(normBase, slug)
    }
  }

  // 1. Exact match (also space-insensitive, so acronym camelCase like
  //    "TrueNAS" -> "truenas" still resolves despite the camelCase split)
  const exactSlug = baseIndex.get(normLabel)
  if (exactSlug) return { slug: exactSlug, confidence: 'exact' }
  const normLabelCompact = normLabel.replace(/ /g, '')
  for (const [normBase, slug] of baseIndex) {
    if (normBase.replace(/ /g, '') === normLabelCompact) {
      return { slug, confidence: 'exact' }
    }
  }

  // 2. Prefix / contains match — label is prefix of slug base or vice versa
  for (const [normBase, slug] of baseIndex) {
    if (normBase.startsWith(normLabel) || normLabel.startsWith(normBase)) {
      // Require the shorter string to be at least 4 chars to avoid noise
      const shorter = normBase.length < normLabel.length ? normBase : normLabel
      if (shorter.length >= 4) return { slug, confidence: 'high' }
    }
  }

  // 3. All label tokens appear in slug tokens (e.g. "Home Assistant" → home-assistant)
  if (labelTokens.length >= 1) {
    for (const [normBase, slug] of baseIndex) {
      const baseTokens = normBase.split(' ').filter(Boolean)
      if (labelTokens.every((t) => baseTokens.includes(t))) {
        return { slug, confidence: 'high' }
      }
    }
  }

  // 4. Single shared meaningful token (partial)
  if (labelTokens.length >= 1) {
    for (const [normBase, slug] of baseIndex) {
      const baseTokens = normBase.split(' ').filter(Boolean)
      const shared = labelTokens.filter((t) => t.length >= 4 && baseTokens.includes(t))
      if (shared.length > 0) return { slug, confidence: 'partial' }
    }
  }

  return null
}

/** Node types that are structural (not real devices) — skip these. */
const SKIP_TYPES = new Set(['group', 'groupRect', 'text'])

const ICON_PREFIXES = ['brand:', 'mdi:', 'si:', 'sh:', 'https://', 'http://', '/icons/']

export function shouldSkipNode(type: string, customIcon?: string): boolean {
  if (SKIP_TYPES.has(type)) return true
  // Already has any icon assigned — don't clobber it
  if (customIcon && ICON_PREFIXES.some((p) => customIcon.startsWith(p))) return true
  return false
}

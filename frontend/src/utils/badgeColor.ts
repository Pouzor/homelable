/**
 * Readable accent badges in every interface theme.
 *
 * The accent palette (source / service / category / role colours) is neon,
 * tuned for a dark background — fine as a dark-mode badge, unreadable as text
 * on white. Rather than keep a second palette per map, the text colour is mixed
 * toward the interface foreground by `--badge-ink-mix` (index.css): 0% in the
 * dark looks, so nothing changes there, and enough in the Light interface to
 * pass contrast. Works with any CSS colour, hex or var().
 */
import type { CSSProperties } from 'react'

/** Text / icon colour for an accent on the current interface background. */
export function badgeInk(color: string): string {
  return `color-mix(in srgb, ${color}, var(--foreground) var(--badge-ink-mix, 0%))`
}

/** Translucent fill of an accent — reads on light and dark alike. */
export function badgeTint(color: string, percent = 13): string {
  return `color-mix(in srgb, ${color} ${percent}%, transparent)`
}

/** The usual pill: tinted fill, readable text. */
export function badgeStyle(color: string): CSSProperties {
  return { background: badgeTint(color), color: badgeInk(color) }
}

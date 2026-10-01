// Shared timestamp formatting. Backend timestamps may arrive without a timezone
// suffix (naive UTC); append 'Z' when absent so the browser parses them as UTC
// rather than local time.

import { t, getLocale } from '@/i18n'

function toUtcIso(value: string): string {
  return /[Zz]|[+-]\d{2}:?\d{2}$/.test(value) ? value : value + 'Z'
}

/** Full locale date+time, e.g. for tooltips and the detail panel. */
export function formatTimestamp(value: string): string {
  // Bound to the app locale, not the browser default: a Chinese reader who
  // picked Chinese must not get English month names from an English-locale OS.
  return new Date(toUtcIso(value)).toLocaleString(getLocale())
}

/**
 * Compact relative time, e.g. "just now", "5m ago", "3h ago", "2d ago",
 * "4w ago", "5mo ago", "2y ago". Future timestamps clamp to "just now".
 * `now` is injectable for deterministic tests.
 *
 * The compact unit is part of the key, so a translation may spell the unit out
 * (Chinese renders "15 分钟前" where English shows "15m ago").
 */
export function formatRelative(value: string, now: number = Date.now()): string {
  const then = new Date(toUtcIso(value)).getTime()
  if (Number.isNaN(then)) return ''
  const sec = Math.floor((now - then) / 1000)
  if (sec < 60) return t('just now')
  const min = Math.floor(sec / 60)
  if (min < 60) return t('{n}m ago', { n: min })
  const hr = Math.floor(min / 60)
  if (hr < 24) return t('{n}h ago', { n: hr })
  const day = Math.floor(hr / 24)
  if (day < 7) return t('{n}d ago', { n: day })
  const week = Math.floor(day / 7)
  if (week < 5) return t('{n}w ago', { n: week })
  const month = Math.floor(day / 30)
  if (month < 12) return t('{n}mo ago', { n: month })
  const year = Math.floor(day / 365)
  return t('{n}y ago', { n: year })
}

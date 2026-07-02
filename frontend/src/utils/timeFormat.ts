// Shared timestamp formatting. Backend timestamps may arrive without a timezone
// suffix (naive UTC); append 'Z' when absent so the browser parses them as UTC
// rather than local time.

function toUtcIso(value: string): string {
  return /[Zz]|[+-]\d{2}:?\d{2}$/.test(value) ? value : value + 'Z'
}

/** Full locale date+time, e.g. for tooltips and the detail panel. */
export function formatTimestamp(value: string): string {
  return new Date(toUtcIso(value)).toLocaleString()
}

/**
 * Compact relative time, e.g. "just now", "5m ago", "3h ago", "2d ago",
 * "4w ago", "5mo ago", "2y ago". Future timestamps clamp to "just now".
 * `now` is injectable for deterministic tests.
 */
export function formatRelative(value: string, now: number = Date.now()): string {
  const then = new Date(toUtcIso(value)).getTime()
  if (Number.isNaN(then)) return ''
  const sec = Math.floor((now - then) / 1000)
  if (sec < 60) return 'just now'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day}d ago`
  const week = Math.floor(day / 7)
  if (week < 5) return `${week}w ago`
  const month = Math.floor(day / 30)
  if (month < 12) return `${month}mo ago`
  const year = Math.floor(day / 365)
  return `${year}y ago`
}

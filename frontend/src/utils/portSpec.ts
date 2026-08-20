/**
 * nmap-style port specs — `80`, `1-1024`, or a comma list of both.
 *
 * Mirrors `_parse_port_spec` in `backend/app/services/scanner.py`: the deep-scan
 * dialog validates here so a typo is caught before a request, and the backend
 * validates again because it is the one handing the spec to nmap.
 */

export const FULL_PORT_RANGE = '1-65535'

const TOKEN_RE = /^\d{1,5}(-\d{1,5})?$/

/**
 * Sorted, merged `[start, end]` ranges, or `null` when the spec is unusable.
 * An empty spec is unusable too — a scan of nothing is never what was meant.
 */
export function parsePortSpec(spec: string): Array<[number, number]> | null {
  const tokens = spec.split(',').map((t) => t.trim())
  if (tokens.length === 0 || tokens.some((t) => t === '')) return null

  const ranges: Array<[number, number]> = []
  for (const token of tokens) {
    if (!TOKEN_RE.test(token)) return null
    const parts = token.split('-').map(Number)
    const start = parts[0]
    const end = parts[parts.length - 1]
    if (start < 1 || end > 65535 || start > end) return null
    ranges.push([start, end])
  }

  ranges.sort((a, b) => a[0] - b[0])
  const merged: Array<[number, number]> = [ranges[0]]
  for (const [start, end] of ranges.slice(1)) {
    const last = merged[merged.length - 1]
    if (start <= last[1] + 1) last[1] = Math.max(last[1], end)
    else merged.push([start, end])
  }
  return merged
}

export function isValidPortSpec(spec: string): boolean {
  return parsePortSpec(spec) !== null
}

/** How many ports a spec covers — 0 when it is invalid. */
export function countPorts(spec: string): number {
  const ranges = parsePortSpec(spec)
  if (!ranges) return 0
  return ranges.reduce((sum, [start, end]) => sum + (end - start + 1), 0)
}

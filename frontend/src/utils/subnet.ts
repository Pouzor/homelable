/**
 * IPv4 subnet matching, used by the zone "Import devices by subnet" action.
 *
 * IPv4 only on purpose: a homelab zone is drawn around a LAN segment, and the
 * canvas has no IPv6 grouping story yet. `isValidCidr` rejects an IPv6 CIDR so
 * the modal can say why instead of silently matching nothing.
 */

/** A parsed CIDR: the network address as a 32-bit int, plus the prefix length. */
export interface ParsedCidr {
  base: number
  bits: number
}

/**
 * "192.168.1.42" → 3232235818. Null for anything that is not four decimal
 * octets in 0..255 — no leading zeros, no shorthand.
 */
export function ipToInt(ip: string): number | null {
  const parts = ip.trim().split('.')
  if (parts.length !== 4) return null
  let acc = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const n = Number(part)
    if (n > 255) return null
    acc = acc * 256 + n
  }
  return acc
}

/**
 * Parse "192.168.1.0/24". The host bits of the given address are masked off, so
 * "192.168.1.42/24" and "192.168.1.0/24" parse to the same network.
 *
 * A bare address with no "/" is treated as /32 — one host.
 */
export function parseCidr(cidr: string): ParsedCidr | null {
  const trimmed = cidr.trim()
  if (!trimmed) return null

  const [addr, prefix, ...rest] = trimmed.split('/')
  if (rest.length > 0) return null

  const ip = ipToInt(addr)
  if (ip === null) return null

  let bits = 32
  if (prefix !== undefined) {
    if (!/^\d{1,2}$/.test(prefix)) return null
    bits = Number(prefix)
    if (bits > 32) return null
  }

  // A /0 mask would be `-1 << 32`, which JS evaluates as `-1 << 0` = -1 — the
  // shift count wraps mod 32. Special-cased so "0.0.0.0/0" matches everything.
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
  return { base: (ip & mask) >>> 0, bits }
}

export function isValidCidr(cidr: string): boolean {
  return parseCidr(cidr) !== null
}

/**
 * Does `ip` fall inside `cidr`?
 *
 * `ip` comes straight off node data, so it may carry a prefix ("10.0.0.5/24")
 * or a port ("10.0.0.5:8006"); both suffixes are stripped. Missing or
 * unparseable addresses never match.
 */
export function ipInSubnet(ip: string | null | undefined, cidr: string): boolean {
  const parsed = parseCidr(cidr)
  if (!parsed) return false
  if (!ip) return false

  const bare = ip.trim().split('/')[0].split(':')[0]
  const value = ipToInt(bare)
  if (value === null) return false

  const mask = parsed.bits === 0 ? 0 : (0xffffffff << (32 - parsed.bits)) >>> 0
  return ((value & mask) >>> 0) === parsed.base
}

/**
 * The rule the zone subnet import runs on, shared by the store action and the
 * modal's match-count preview so the number shown is the number that moves.
 *
 * A candidate must be free (no parent — a node already nested in a group, a
 * container host or another zone keeps the parent the user gave it), must not
 * be canvas furniture (which describes nothing physical and so has no IP worth
 * matching), and must have an IP inside the range.
 */
const FURNITURE_TYPES = new Set(['groupRect', 'group', 'text'])

export function isZoneSubnetCandidate(
  node: { id: string; parentId?: string; data: { type: string; ip?: string } },
  cidr: string,
  zoneId?: string,
): boolean {
  if (node.id === zoneId) return false
  if (node.parentId) return false
  if (FURNITURE_TYPES.has(node.data.type)) return false
  return ipInSubnet(node.data.ip, cidr)
}

/**
 * Mask a single IP address:
 * - IPv4 "192.168.1.115" → "192.168.XX.XX"
 * - IPv6 "2001:db8::1"   → "2001:XX::XX"
 * - Other strings returned unchanged.
 */
function maskSingle(ip: string): string {
  const trimmed = ip.trim()
  if (/^[\da-fA-F:]+$/.test(trimmed) && trimmed.includes(':')) {
    const groups = trimmed.split(':')
    if (groups.length >= 2) {
      groups[1] = 'XX'
      groups[groups.length - 1] = 'XX'
      return groups.join(':')
    }
  }
  const parts = trimmed.split('.')
  if (parts.length === 4) return `${parts[0]}.${parts[1]}.XX.XX`
  return trimmed
}

/**
 * Mask all IPs in a comma-separated string.
 * e.g. "192.168.1.1, 2001:db8::1" → "192.168.XX.XX, 2001:XX::XX"
 */
export function maskIp(ip: string): string {
  if (!ip) return ip
  return ip.split(',').map(maskSingle).join(', ')
}

/**
 * Split a comma-separated IP string into an array of trimmed values.
 * Empty string returns [].
 */
export function splitIps(ip: string): string[] {
  if (!ip?.trim()) return []
  return ip.split(',').map((s) => s.trim()).filter(Boolean)
}

/**
 * Return the first IP from a comma-separated string (used for status checks).
 */
export function primaryIp(ip: string): string {
  return splitIps(ip)[0] ?? ''
}

export function primaryIp(ip: string): string {
  if (!ip?.trim()) return ''
  return ip.split(',')[0].trim()
}

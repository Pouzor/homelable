/**
 * Mask the last two octets of an IPv4 address.
 * e.g. "192.168.1.115" → "192.168.XX.XX"
 * Non-IPv4 strings are returned unchanged.
 */
export function maskIp(ip: string): string {
  const parts = ip.split('.')
  if (parts.length === 4) return `${parts[0]}.${parts[1]}.XX.XX`
  return ip
}

export function primaryIp(ip: string): string {
  if (!ip?.trim()) return ''
  return ip.split(',')[0].trim()
}

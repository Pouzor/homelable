import type { ServiceInfo } from '@/types'

// Ports that are definitely not HTTP/web services (port 22/SSH handled separately)
const NON_HTTP_PORTS = new Set([
  21,             // FTP
  23,             // Telnet
  25, 465, 587,   // SMTP
  53,             // DNS
  110, 143, 993, 995,   // IMAP / POP3
  389, 636,       // LDAP
  445,            // SMB
  514,            // Syslog
  1433,           // MSSQL
  3306,           // MySQL
  5432,           // PostgreSQL
  5672,           // RabbitMQ AMQP
  6379,           // Redis
  9092,           // Kafka
  11211,          // Memcached
  27017, 27018,   // MongoDB
])

function splitFirstHost(host: string): string {
  return host.split(',')[0]?.trim() ?? ''
}

function parsePort(port: string): number | undefined {
  if (!/^\d+$/.test(port)) return undefined
  const parsed = Number.parseInt(port, 10)
  return parsed >= 1 && parsed <= 65535 ? parsed : undefined
}

function parseHostParts(host: string): { protocol?: 'http' | 'https'; hostname: string; port?: number } | null {
  const firstHost = splitFirstHost(host)
  if (!firstHost) return null

  if (firstHost.startsWith('http://') || firstHost.startsWith('https://')) {
    const url = new URL(firstHost)
    return {
      protocol: url.protocol === 'https:' ? 'https' : 'http',
      hostname: url.hostname,
      port: parsePort(url.port),
    }
  }

  if (firstHost.startsWith('[')) {
    const bracketIndex = firstHost.indexOf(']')
    if (bracketIndex === -1) return { hostname: firstHost }
    const hostname = firstHost.slice(1, bracketIndex)
    const remainder = firstHost.slice(bracketIndex + 1)
    return {
      hostname,
      port: remainder.startsWith(':') ? parsePort(remainder.slice(1)) : undefined,
    }
  }

  const colonCount = (firstHost.match(/:/g) ?? []).length
  if (colonCount === 1) {
    const [hostname, rawPort] = firstHost.split(':')
    const parsedPort = parsePort(rawPort)
    if (hostname && parsedPort != null) {
      return { hostname, port: parsedPort }
    }
  }

  return { hostname: firstHost }
}

function normalizePath(path?: string): string {
  const trimmed = path?.trim()
  if (!trimmed) return ''
  if (trimmed === '/') return '/'
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`
}

function formatHostname(hostname: string): string {
  return hostname.includes(':') && !hostname.startsWith('[') ? `[${hostname}]` : hostname
}

export function getServiceUrl(svc: ServiceInfo, host?: string): string | null {
  if (!host) return null
  if (svc.protocol === 'udp') return null // UDP — not HTTP

  const parts = parseHostParts(host)
  if (!parts?.hostname) return null

  const effectivePort = svc.port ?? parts.port
  if (effectivePort === 22) return null // SSH — no browser
  if (effectivePort != null && NON_HTTP_PORTS.has(effectivePort)) return null

  const name = svc.service_name.toLowerCase()
  const protocol = parts.protocol ?? (
    name.includes('https') || name.includes('ssl') || name.includes('tls') ||
    effectivePort === 443 || effectivePort === 8443
      ? 'https'
      : 'http'
  )
  const base = `${protocol}://${formatHostname(parts.hostname)}`
  const port = effectivePort != null ? `:${effectivePort}` : ''
  return `${base}${port}${normalizePath(svc.path)}`
}

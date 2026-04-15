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

function normalizeServiceHost(host: string): string {
  const trimmed = host.trim()
  if (!trimmed) return trimmed

  if (/^[a-z]+:\/\//i.test(trimmed)) {
    try {
      return new URL(trimmed).hostname
    } catch {
      return trimmed
    }
  }

  // Strip a user-supplied port from plain hosts like 192.168.1.10:8006 or nas.lan:5000.
  if (/^[^/\[\]]+:\d+$/.test(trimmed) && trimmed.indexOf(':') === trimmed.lastIndexOf(':')) {
    return trimmed.replace(/:\d+$/, '')
  }

  return trimmed
}

export function getServiceUrl(svc: ServiceInfo, host?: string): string | null {
  if (!host) return null
  const normalizedHost = normalizeServiceHost(host)
  if (!normalizedHost) return null
  if (svc.port === 22) return null        // SSH — no browser
  if (svc.protocol === 'udp') return null // UDP — not HTTP
  if (NON_HTTP_PORTS.has(svc.port)) return null

  const name = svc.service_name.toLowerCase()
  const isHttps =
    name.includes('https') || name.includes('ssl') || name.includes('tls') ||
    svc.port === 443 || svc.port === 8443
  return `${isHttps ? 'https' : 'http'}://${normalizedHost}:${svc.port}`
}

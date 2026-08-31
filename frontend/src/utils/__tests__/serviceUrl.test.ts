import { describe, it, expect } from 'vitest'
import { getServiceUrl } from '@/utils/serviceUrl'
import type { ServiceInfo } from '@/types'

const svc = (port?: number, protocol: 'tcp' | 'udp' = 'tcp', service_name = 'test', path?: string): ServiceInfo => ({
  ...(port != null ? { port } : {}),
  protocol,
  service_name,
  ...(path ? { path } : {}),
})

describe('getServiceUrl', () => {
  it('returns null when no host is provided', () => {
    expect(getServiceUrl(svc(80), undefined)).toBeNull()
  })

  it('returns null for port 22 (SSH)', () => {
    expect(getServiceUrl(svc(22, 'tcp', 'ssh'), '192.168.1.1')).toBeNull()
  })

  it('returns null for UDP services', () => {
    expect(getServiceUrl(svc(53, 'udp', 'dns'), '192.168.1.1')).toBeNull()
  })

  it('returns null for known non-HTTP TCP ports', () => {
    expect(getServiceUrl(svc(3306, 'tcp', 'mysql'), '192.168.1.1')).toBeNull()
    expect(getServiceUrl(svc(5432, 'tcp', 'postgres'), '192.168.1.1')).toBeNull()
    expect(getServiceUrl(svc(6379, 'tcp', 'redis'), '192.168.1.1')).toBeNull()
    expect(getServiceUrl(svc(27017, 'tcp', 'mongodb'), '192.168.1.1')).toBeNull()
  })

  it('returns http URL for standard HTTP port', () => {
    expect(getServiceUrl(svc(80, 'tcp', 'http'), '192.168.1.10')).toBe('http://192.168.1.10:80')
  })

  it('returns https URL for port 443', () => {
    expect(getServiceUrl(svc(443, 'tcp', 'https'), '10.0.0.1')).toBe('https://10.0.0.1:443')
  })

  it('returns https URL for port 8443', () => {
    expect(getServiceUrl(svc(8443), '10.0.0.1')).toBe('https://10.0.0.1:8443')
  })

  it('returns https URL when service name contains ssl', () => {
    expect(getServiceUrl(svc(9443, 'tcp', 'my-ssl-app'), '10.0.0.1')).toBe('https://10.0.0.1:9443')
  })

  it('returns http URL for Sonarr on port 8989', () => {
    expect(getServiceUrl(svc(8989, 'tcp', 'Sonarr'), '192.168.1.5')).toBe('http://192.168.1.5:8989')
  })

  it('returns http URL for Radarr on port 7878', () => {
    expect(getServiceUrl(svc(7878, 'tcp', 'Radarr'), '192.168.1.5')).toBe('http://192.168.1.5:7878')
  })

  it('returns http URL for Jellyfin on port 8096', () => {
    expect(getServiceUrl(svc(8096, 'tcp', 'Jellyfin'), '192.168.1.5')).toBe('http://192.168.1.5:8096')
  })

  it('returns http URL for Proxmox web UI on port 8006', () => {
    expect(getServiceUrl(svc(8006, 'tcp', 'Proxmox'), '192.168.1.100')).toBe('http://192.168.1.100:8006')
  })

  it('uses host string directly (works with both IP and hostname)', () => {
    expect(getServiceUrl(svc(80), 'myserver.lan')).toBe('http://myserver.lan:80')
  })

  it('uses the node port when the host already includes one', () => {
    expect(getServiceUrl(svc(undefined, 'tcp', 'app'), '192.168.1.10:8080')).toBe('http://192.168.1.10:8080')
  })

  it('lets the service port override the node port', () => {
    expect(getServiceUrl(svc(3000, 'tcp', 'app'), '192.168.1.10:8080')).toBe('http://192.168.1.10:3000')
  })

  it('appends a normalized path to the final URL', () => {
    expect(getServiceUrl(svc(3000, 'tcp', 'app', 'admin/login'), '192.168.1.10')).toBe('http://192.168.1.10:3000/admin/login')
  })

  it('supports path-only services inheriting the node port', () => {
    expect(getServiceUrl(svc(undefined, 'tcp', 'app', '/metrics'), '192.168.1.10:9090')).toBe('http://192.168.1.10:9090/metrics')
  })

  describe('service host override', () => {
    const withHost = (host: string, port?: number, path?: string): ServiceInfo =>
      ({ ...svc(port, 'tcp', 'app', path), host })

    it('uses the service host instead of the node one', () => {
      expect(getServiceUrl(withHost('blog.example.com', 8080), '192.168.1.10')).toBe('http://blog.example.com')
    })

    it('drops the scanned port so a reverse-proxy host stays reachable', () => {
      expect(getServiceUrl(withHost('https://mywebserver.mydomain.com', 8083), '192.168.100.100')).toBe('https://mywebserver.mydomain.com')
    })

    it('falls back to the node host when the override is blank', () => {
      expect(getServiceUrl(withHost('   ', 8080), '192.168.1.10')).toBe('http://192.168.1.10:8080')
    })

    it('resolves against the override even when the node has no host', () => {
      expect(getServiceUrl(withHost('blog.example.com', 80), undefined)).toBe('http://blog.example.com')
    })

    it('honours a scheme carried by the override', () => {
      expect(getServiceUrl(withHost('https://blog.example.com'), '192.168.1.10')).toBe('https://blog.example.com')
    })

    it('takes the port from the override when the service has none', () => {
      expect(getServiceUrl(withHost('blog.example.com:8443'), '192.168.1.10:80')).toBe('https://blog.example.com:8443')
    })

    it('appends the service path to the override host', () => {
      expect(getServiceUrl(withHost('blog.example.com', 3000, 'admin'), '192.168.1.10')).toBe('http://blog.example.com/admin')
    })

    it('returns null for a scheme-only override instead of throwing', () => {
      expect(getServiceUrl(withHost('https://', 443), '192.168.1.10')).toBeNull()
    })

    it('keeps the port typed into the override host over the scanned one', () => {
      expect(getServiceUrl(withHost('blog.example.com:8443', 3000), '192.168.1.10')).toBe('http://blog.example.com:8443')
    })

    it('still gates the override on the scanned port', () => {
      expect(getServiceUrl(withHost('db.example.com', 3306), '192.168.1.10')).toBeNull()
      expect(getServiceUrl(withHost('shell.example.com', 22), '192.168.1.10')).toBeNull()
    })

    it('still returns null for a UDP service', () => {
      expect(getServiceUrl({ ...svc(53, 'udp', 'dns'), host: 'dns.example.com' }, '192.168.1.10')).toBeNull()
    })
  })
})

import { describe, it, expect } from 'vitest'
import { getServiceUrl } from '@/utils/serviceUrl'
import type { ServiceInfo } from '@/types'

const svc = (port: number, protocol: 'tcp' | 'udp' = 'tcp', service_name = 'test'): ServiceInfo => ({
  port,
  protocol,
  service_name,
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
})

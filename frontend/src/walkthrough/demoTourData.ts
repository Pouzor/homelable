import type { ScanRun } from '@/components/modals/ScanHistoryModal'
import type { PendingDevice } from '@/components/modals/PendingDeviceModal'

/**
 * Canned data injected into the real modals during the tour, so the demo steps
 * look alive on a fresh install without hitting the backend. Never persisted.
 */
export const DEMO_SCAN_RUNS: ScanRun[] = [
  {
    id: 'tour-scan-running',
    status: 'running',
    kind: 'ip',
    ranges: ['192.168.1.0/24'],
    devices_found: 12,
    // 8s ago so the live "Duration" reads a realistic elapsed time.
    started_at: new Date(Date.now() - 8000).toISOString(),
    finished_at: null,
    error: null,
  },
  {
    id: 'tour-scan-done',
    status: 'done',
    kind: 'ip',
    ranges: ['192.168.1.0/24'],
    devices_found: 9,
    started_at: new Date(Date.now() - 3600_000).toISOString(),
    finished_at: new Date(Date.now() - 3560_000).toISOString(),
    error: null,
  },
]

export const DEMO_PENDING_DEVICES: PendingDevice[] = [
  {
    id: 'tour-dev-1',
    ip: '192.168.1.20',
    mac: 'AA:BB:CC:DD:EE:20',
    hostname: 'synology-nas',
    os: 'DSM 7.2',
    services: [{ port: 5000, protocol: 'tcp', service_name: 'Synology DSM', category: 'nas' }],
    suggested_type: 'nas',
    status: 'pending',
    discovery_source: 'arp',
    friendly_name: 'Synology NAS',
    vendor: 'Synology',
    model: 'DS920+',
    discovered_at: new Date(Date.now() - 120_000).toISOString(),
    canvas_count: 0,
  },
  {
    id: 'tour-dev-2',
    ip: '192.168.1.30',
    mac: 'AA:BB:CC:DD:EE:30',
    hostname: 'pi-hole',
    os: null,
    services: [{ port: 80, protocol: 'tcp', service_name: 'Pi-hole', category: 'network' }],
    suggested_type: 'generic',
    status: 'pending',
    discovery_source: 'arp',
    friendly_name: 'Pi-hole',
    vendor: 'Raspberry Pi',
    model: null,
    discovered_at: new Date(Date.now() - 90_000).toISOString(),
    canvas_count: 0,
  },
]

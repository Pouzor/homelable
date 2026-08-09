import { describe, it, expect } from 'vitest'
import { isRackable, UNRACKABLE_TYPES } from '../rackable'
import type { InventoryEntry } from '@/components/modals/InventoryDeviceModal'

function device(suggested_type: string | null): InventoryEntry {
  return {
    id: 'd1',
    ip: null,
    mac: null,
    hostname: null,
    os: null,
    services: [],
    suggested_type,
    status: 'pending',
    discovery_source: 'arp',
    discovered_at: '2026-01-01T00:00:00Z',
  }
}

describe('isRackable', () => {
  it('takes hardware kinds', () => {
    for (const type of ['server', 'switch', 'nas', 'proxmox', 'router', 'ups']) {
      expect(isRackable(device(type))).toBe(true)
    }
  })

  it('rejects virtual, mesh and annotation kinds', () => {
    for (const type of ['vm', 'lxc', 'docker_container', 'zigbee_enddevice', 'text']) {
      expect(isRackable(device(type))).toBe(false)
    }
  })

  it('keeps an unclassified device — the scanner just has not named it', () => {
    // A bare ARP hit has no suggested_type; hiding those would empty the picker
    // on a freshly scanned network.
    expect(isRackable(device(null))).toBe(true)
  })

  it('is an exclusion list, so a new hardware type is rackable by default', () => {
    expect(isRackable(device('tape_library'))).toBe(true)
    expect(UNRACKABLE_TYPES.has('tape_library')).toBe(false)
  })
})

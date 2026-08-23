import { describe, it, expect } from 'vitest'
import { sourceBuckets, orderedSources, isRackDevice } from '../deviceSources'
import type { InventoryEntry } from '@/components/modals/InventoryDeviceModal'

function device(overrides: Partial<InventoryEntry> = {}): InventoryEntry {
  return {
    id: 'd1',
    ip: null,
    mac: null,
    hostname: null,
    os: null,
    services: [],
    suggested_type: null,
    status: 'pending',
    discovery_source: null,
    discovered_at: '2026-07-05T00:00:00Z',
    ...overrides,
  }
}

describe('sourceBuckets', () => {
  it('returns both IP and Proxmox for a merged device', () => {
    const buckets = sourceBuckets(device({ discovery_sources: ['arp', 'proxmox'] }))
    expect([...buckets].sort()).toEqual(['ip', 'proxmox'])
  })

  it('returns both IP and Synology for a merged device', () => {
    const buckets = sourceBuckets(device({ discovery_sources: ['arp', 'synology'] }))
    expect([...buckets].sort()).toEqual(['ip', 'synology'])
  })

  it('maps arp and mdns to the single ip bucket', () => {
    expect([...sourceBuckets(device({ discovery_sources: ['arp'] }))]).toEqual(['ip'])
    expect([...sourceBuckets(device({ discovery_sources: ['mdns'] }))]).toEqual(['ip'])
  })

  it('falls back to legacy discovery_source when discovery_sources is empty', () => {
    expect([...sourceBuckets(device({ discovery_source: 'zigbee' }))]).toEqual(['zigbee'])
    expect([...sourceBuckets(device({ discovery_source: 'proxmox' }))]).toEqual(['proxmox'])
    expect([...sourceBuckets(device({ discovery_source: 'synology' }))]).toEqual(['synology'])
  })

  it('uses the ieee heuristic when no source is recorded', () => {
    // Mesh device (non-pve ieee) with no discovery_source → zigbee.
    expect([...sourceBuckets(device({ ieee_address: '0x00124b00' }))]).toEqual(['zigbee'])
    // Nothing at all → ip.
    expect([...sourceBuckets(device())]).toEqual(['ip'])
  })
})

describe('orderedSources', () => {
  it('renders IP before Proxmox regardless of input order', () => {
    expect(orderedSources(device({ discovery_sources: ['proxmox', 'arp'] }))).toEqual(['ip', 'proxmox'])
  })

  it('renders IP before Synology regardless of input order', () => {
    expect(orderedSources(device({ discovery_sources: ['synology', 'arp'] }))).toEqual(['ip', 'synology'])
  })
})

describe('isRackDevice', () => {
  it('recognises gear created from a rack canvas', () => {
    expect(isRackDevice(device({ discovery_sources: ['rack'] }))).toBe(true)
    expect(isRackDevice(device({ discovery_source: 'rack' }))).toBe(true)
  })

  it('leaves scanned and hand-added devices alone', () => {
    expect(isRackDevice(device({ discovery_sources: ['arp'] }))).toBe(false)
    expect(isRackDevice(device({ discovery_source: 'manual' }))).toBe(false)
    expect(isRackDevice(device())).toBe(false)
  })

  it('does not fold rack into the ip bucket', () => {
    // Rack gear has to be filterable on its own — that is the point of the
    // "Rack devices" section in the inventory.
    expect([...sourceBuckets(device({ discovery_source: 'rack' }))]).toEqual(['rack'])
  })
})

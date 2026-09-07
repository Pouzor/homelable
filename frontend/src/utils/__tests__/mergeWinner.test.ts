import { describe, it, expect } from 'vitest'
import { deviceName, factCount, suggestWinner } from '@/utils/mergeWinner'
import type { InventoryEntry } from '@/types'

function entry(over: Partial<InventoryEntry>): InventoryEntry {
  return {
    id: 'x', ip: null, mac: null, hostname: null, os: null, services: [],
    suggested_type: null, status: 'pending', discovered_at: '2026-01-01T00:00:00Z',
    ...over,
  } as InventoryEntry
}

describe('suggestWinner', () => {
  it('prefers the row carrying an IEEE — imports and links key on it', () => {
    const devices = [
      entry({ id: 'canvas', canvas_count: 1, discovered_at: '2025-01-01T00:00:00Z' }),
      entry({ id: 'proxmox', ieee_address: 'pve-pve1-130' }),
    ]
    expect(suggestWinner(devices)).toBe('proxmox')
  })

  it('falls back to a row that is already drawn on a canvas', () => {
    const devices = [
      entry({ id: 'stub' }),
      entry({ id: 'drawn', canvas_count: 2, discovered_at: '2026-06-01T00:00:00Z' }),
    ]
    expect(suggestWinner(devices)).toBe('drawn')
  })

  it('falls back to the oldest row when nothing else separates them', () => {
    const devices = [
      entry({ id: 'young', discovered_at: '2026-06-01T00:00:00Z' }),
      entry({ id: 'old', discovered_at: '2025-02-01T00:00:00Z' }),
    ]
    expect(suggestWinner(devices)).toBe('old')
  })

  it('is undefined for an empty selection', () => {
    expect(suggestWinner([])).toBeUndefined()
  })
})

describe('factCount', () => {
  it('counts the scalars, services and properties a row knows', () => {
    const rich = entry({
      ip: '192.168.1.62', mac: 'bc:24:11:95:af:8c', hostname: 'n8n',
      services: [{ port: 22, protocol: 'tcp', service_name: 'ssh' }] as InventoryEntry['services'],
      properties: [{ key: 'VMID', value: '130' }] as InventoryEntry['properties'],
    })
    expect(factCount(rich)).toBe(5)
    expect(factCount(entry({}))).toBe(0)
  })
})

describe('deviceName', () => {
  it('prefers the name the user gave the device', () => {
    expect(deviceName(entry({ label: 'n8n', hostname: 'ct130', ip: '10.0.0.1' }))).toBe('n8n')
    expect(deviceName(entry({ hostname: 'ct130', ip: '10.0.0.1' }))).toBe('ct130')
    expect(deviceName(entry({}))).toBe('device')
  })
})

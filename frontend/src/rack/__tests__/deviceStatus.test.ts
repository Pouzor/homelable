import { describe, it, expect } from 'vitest'
import { MOUNT_STATUSES, canFollowNode, resolveDeviceStatus } from '../deviceStatus'
import type { InventoryDevice } from '@/types'

function entry(over: Partial<InventoryDevice> = {}): InventoryDevice {
  return {
    id: 'inv-1',
    label: 'nas',
    type: 'nas',
    ip: '192.168.1.10',
    status: 'online',
    nodeId: 'node-1',
    racked: false,
    suggestedFaceplateId: 'server-1u',
    ...over,
  }
}

describe('canFollowNode', () => {
  it('needs an entry the backend matched to a canvas node', () => {
    expect(canFollowNode(entry())).toBe(true)
    expect(canFollowNode(entry({ nodeId: null }))).toBe(false)
    expect(canFollowNode(undefined)).toBe(false)
  })
})

describe('resolveDeviceStatus', () => {
  it('returns a pinned status untouched', () => {
    expect(resolveDeviceStatus({ status: 'offline', deviceId: 'inv-1' }, [entry()])).toBe('offline')
  })

  it('reads the inventory entry live status when the mount follows the node', () => {
    expect(resolveDeviceStatus({ status: 'auto', deviceId: 'inv-1' }, [entry()])).toBe('online')
    expect(
      resolveDeviceStatus({ status: 'auto', deviceId: 'inv-1' }, [entry({ status: 'offline' })]),
    ).toBe('offline')
  })

  it('falls back to unknown when there is nothing to read', () => {
    // Accessory (no entry), purged inventory, entry with no node behind it: the
    // rack has no checker of its own, so it must not invent a colour.
    expect(resolveDeviceStatus({ status: 'auto', deviceId: null }, [entry()])).toBe('unknown')
    expect(resolveDeviceStatus({ status: 'auto', deviceId: 'gone' }, [entry()])).toBe('unknown')
    expect(
      resolveDeviceStatus({ status: 'auto', deviceId: 'inv-1' }, [
        entry({ status: 'unknown', nodeId: null }),
      ]),
    ).toBe('unknown')
  })

  it('offers auto first in the Status select', () => {
    expect(MOUNT_STATUSES).toEqual(['auto', 'online', 'offline', 'unknown'])
  })
})

import { describe, it, expect } from 'vitest'
import { ipToInt, parseCidr, isValidCidr, ipInSubnet, isZoneSubnetCandidate } from '@/utils/subnet'

describe('ipToInt', () => {
  it('converts a dotted quad', () => {
    expect(ipToInt('0.0.0.0')).toBe(0)
    expect(ipToInt('255.255.255.255')).toBe(4294967295)
    expect(ipToInt('192.168.1.42')).toBe(3232235818)
  })

  it('tolerates surrounding whitespace', () => {
    expect(ipToInt('  10.0.0.1  ')).toBe(ipToInt('10.0.0.1'))
  })

  it('rejects malformed addresses', () => {
    for (const bad of ['', '1.2.3', '1.2.3.4.5', '256.0.0.1', '1.2.3.-1', 'a.b.c.d', '1.2.3.4/24', '::1']) {
      expect(ipToInt(bad)).toBeNull()
    }
  })
})

describe('parseCidr', () => {
  it('masks the host bits off, so any address in the range parses to the network', () => {
    expect(parseCidr('192.168.1.42/24')).toEqual(parseCidr('192.168.1.0/24'))
  })

  it('treats a bare address as /32', () => {
    expect(parseCidr('10.0.0.7')).toEqual({ base: ipToInt('10.0.0.7'), bits: 32 })
  })

  it('handles /0 without the shift wrapping to -1', () => {
    expect(parseCidr('0.0.0.0/0')).toEqual({ base: 0, bits: 0 })
    expect(parseCidr('192.168.1.1/0')).toEqual({ base: 0, bits: 0 })
  })

  it('rejects junk', () => {
    for (const bad of ['', '   ', '192.168.1.0/33', '192.168.1.0/x', '192.168.1.0/24/8', '192.168.1.0/', 'not-an-ip/24']) {
      expect(parseCidr(bad)).toBeNull()
    }
  })

  it('rejects IPv6 — out of scope, so the UI can say why', () => {
    expect(parseCidr('2001:db8::/32')).toBeNull()
    expect(isValidCidr('2001:db8::/32')).toBe(false)
  })
})

describe('ipInSubnet', () => {
  it('matches inside a /24 and rejects the neighbours', () => {
    expect(ipInSubnet('192.168.1.1', '192.168.1.0/24')).toBe(true)
    expect(ipInSubnet('192.168.1.255', '192.168.1.0/24')).toBe(true)
    expect(ipInSubnet('192.168.2.1', '192.168.1.0/24')).toBe(false)
    expect(ipInSubnet('192.168.0.255', '192.168.1.0/24')).toBe(false)
  })

  it('honours wider and narrower prefixes', () => {
    expect(ipInSubnet('10.4.9.2', '10.0.0.0/8')).toBe(true)
    expect(ipInSubnet('11.4.9.2', '10.0.0.0/8')).toBe(false)
    expect(ipInSubnet('10.0.0.7', '10.0.0.7/32')).toBe(true)
    expect(ipInSubnet('10.0.0.8', '10.0.0.7/32')).toBe(false)
    expect(ipInSubnet('8.8.8.8', '0.0.0.0/0')).toBe(true)
  })

  it('strips a prefix or port suffix off the node address', () => {
    expect(ipInSubnet('192.168.1.5/24', '192.168.1.0/24')).toBe(true)
    expect(ipInSubnet('192.168.1.5:8006', '192.168.1.0/24')).toBe(true)
  })

  it('never matches a missing or unparseable address', () => {
    expect(ipInSubnet(undefined, '192.168.1.0/24')).toBe(false)
    expect(ipInSubnet(null, '192.168.1.0/24')).toBe(false)
    expect(ipInSubnet('', '192.168.1.0/24')).toBe(false)
    expect(ipInSubnet('fe80::1', '192.168.1.0/24')).toBe(false)
  })

  it('never matches against an invalid CIDR', () => {
    expect(ipInSubnet('192.168.1.5', 'nonsense')).toBe(false)
  })
})

describe('isZoneSubnetCandidate', () => {
  const node = (over: Partial<{ id: string; parentId?: string; type: string; ip?: string }> = {}) => ({
    id: over.id ?? 'n1',
    parentId: over.parentId,
    data: { type: over.type ?? 'server', ip: 'ip' in over ? over.ip : '192.168.1.5' },
  })

  it('accepts a free, addressed device in range', () => {
    expect(isZoneSubnetCandidate(node(), '192.168.1.0/24', 'z1')).toBe(true)
  })

  it('leaves an already-parented node with the parent the user gave it', () => {
    expect(isZoneSubnetCandidate(node({ parentId: 'g1' }), '192.168.1.0/24', 'z1')).toBe(false)
  })

  it('skips canvas furniture', () => {
    for (const type of ['groupRect', 'group', 'text']) {
      expect(isZoneSubnetCandidate(node({ type }), '192.168.1.0/24', 'z1')).toBe(false)
    }
  })

  it('never treats the zone itself as a candidate', () => {
    expect(isZoneSubnetCandidate(node({ id: 'z1', type: 'server' }), '192.168.1.0/24', 'z1')).toBe(false)
  })

  it('rejects an out-of-range or address-less node', () => {
    expect(isZoneSubnetCandidate(node({ ip: '10.0.0.1' }), '192.168.1.0/24', 'z1')).toBe(false)
    expect(isZoneSubnetCandidate(node({ ip: undefined }), '192.168.1.0/24', 'z1')).toBe(false)
  })
})

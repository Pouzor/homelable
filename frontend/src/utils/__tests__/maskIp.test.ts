import { describe, it, expect } from 'vitest'
import { maskIp, splitIps, primaryIp } from '../maskIp'

describe('maskIp', () => {
  // IPv4
  it('masks last two octets of a standard IPv4', () => {
    expect(maskIp('192.168.1.115')).toBe('192.168.XX.XX')
  })

  it('masks any IPv4', () => {
    expect(maskIp('10.0.0.1')).toBe('10.0.XX.XX')
    expect(maskIp('172.16.254.1')).toBe('172.16.XX.XX')
  })

  // IPv6
  it('masks second group and last group of an IPv6 address', () => {
    expect(maskIp('2001:db8::1')).toBe('2001:XX::XX')
  })

  it('masks a full IPv6 address', () => {
    expect(maskIp('fe80:0000:0000:0000:0202:b3ff:fe1e:8329')).toBe('fe80:XX:0000:0000:0202:b3ff:fe1e:XX')
  })

  it('masks loopback IPv6', () => {
    // ::1 splits into ['', '', '1'] — groups[1] and last are masked
    expect(maskIp('::1')).toBe(':XX:XX')
  })

  // Comma-separated
  it('masks all IPs in a comma-separated string', () => {
    expect(maskIp('192.168.1.1, 2001:db8::1')).toBe('192.168.XX.XX, 2001:XX::XX')
  })

  it('handles comma-separated without spaces', () => {
    expect(maskIp('10.0.0.1,10.0.0.2')).toBe('10.0.XX.XX, 10.0.XX.XX')
  })

  // Edge cases
  it('passes through non-IP strings unchanged', () => {
    expect(maskIp('hostname')).toBe('hostname')
    expect(maskIp('')).toBe('')
  })
})

describe('splitIps', () => {
  it('returns array of trimmed IPs', () => {
    expect(splitIps('192.168.1.1, 2001:db8::1')).toEqual(['192.168.1.1', '2001:db8::1'])
  })

  it('returns single-element array for single IP', () => {
    expect(splitIps('10.0.0.1')).toEqual(['10.0.0.1'])
  })

  it('returns empty array for empty string', () => {
    expect(splitIps('')).toEqual([])
    expect(splitIps('   ')).toEqual([])
  })
})

describe('primaryIp', () => {
  it('returns first IP from comma-separated string', () => {
    expect(primaryIp('192.168.1.1, 2001:db8::1')).toBe('192.168.1.1')
  })

  it('returns the only IP when single', () => {
    expect(primaryIp('10.0.0.1')).toBe('10.0.0.1')
  })

  it('returns empty string for empty input', () => {
    expect(primaryIp('')).toBe('')
  })
})

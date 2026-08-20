import { describe, it, expect } from 'vitest'
import { parsePortSpec, isValidPortSpec, countPorts, FULL_PORT_RANGE } from '../portSpec'

describe('parsePortSpec', () => {
  it('reads a single port, a range and a comma list', () => {
    expect(parsePortSpec('80')).toEqual([[80, 80]])
    expect(parsePortSpec('1-1024')).toEqual([[1, 1024]])
    expect(parsePortSpec('443,80')).toEqual([[80, 80], [443, 443]])
  })

  it('merges overlapping and adjacent ranges', () => {
    expect(parsePortSpec('1-100,50-200')).toEqual([[1, 200]])
    expect(parsePortSpec('1-100,101-200')).toEqual([[1, 200]])
    expect(parsePortSpec('1-100,300-400')).toEqual([[1, 100], [300, 400]])
  })

  it('tolerates whitespace around tokens', () => {
    expect(parsePortSpec(' 80 , 443 ')).toEqual([[80, 80], [443, 443]])
  })

  it('rejects what nmap could not use', () => {
    for (const bad of ['', '  ', '0', '65536', '100-50', '80,', 'http', '80-', '-80', '1-2-3']) {
      expect(parsePortSpec(bad)).toBeNull()
    }
  })
})

describe('isValidPortSpec / countPorts', () => {
  it('counts merged ranges once', () => {
    expect(countPorts('1-100,50-200')).toBe(200)
    expect(countPorts('80,443')).toBe(2)
    expect(countPorts(FULL_PORT_RANGE)).toBe(65535)
  })

  it('counts an invalid spec as nothing', () => {
    expect(isValidPortSpec('nope')).toBe(false)
    expect(countPorts('nope')).toBe(0)
  })
})

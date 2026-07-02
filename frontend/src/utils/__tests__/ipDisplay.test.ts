import { describe, it, expect, beforeEach } from 'vitest'
import { readHideIp, writeHideIp } from '@/utils/ipDisplay'

describe('ipDisplay persistence', () => {
  beforeEach(() => localStorage.clear())

  it('defaults to false when nothing is stored', () => {
    expect(readHideIp()).toBe(false)
  })

  it('round-trips true', () => {
    writeHideIp(true)
    expect(localStorage.getItem('homelable.hideIp')).toBe('true')
    expect(readHideIp()).toBe(true)
  })

  it('round-trips false', () => {
    writeHideIp(true)
    writeHideIp(false)
    expect(readHideIp()).toBe(false)
  })
})

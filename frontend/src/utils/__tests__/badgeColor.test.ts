import { describe, it, expect } from 'vitest'
import { badgeInk, badgeStyle, badgeTint } from '@/utils/badgeColor'

describe('badgeColor', () => {
  it('mixes the accent toward the foreground by the theme-driven amount', () => {
    expect(badgeInk('#e3b341')).toBe('color-mix(in srgb, #e3b341, var(--foreground) var(--badge-ink-mix, 0%))')
  })

  it('tints the fill with a translucent accent, also for var() colours', () => {
    expect(badgeTint('var(--primary)')).toBe('color-mix(in srgb, var(--primary) 13%, transparent)')
    expect(badgeTint('#00d4ff', 33)).toBe('color-mix(in srgb, #00d4ff 33%, transparent)')
  })

  it('builds the pill style from both', () => {
    expect(badgeStyle('#39d353')).toEqual({ background: badgeTint('#39d353'), color: badgeInk('#39d353') })
  })
})

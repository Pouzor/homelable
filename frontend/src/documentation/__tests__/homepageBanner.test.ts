import { beforeEach, describe, expect, it } from 'vitest'

import {
  HOMEPAGE_BANNER_KEY,
  HOMEPAGE_BANNER_SNOOZE_MS,
  dismissHomepageBanner,
  isHomepageBannerDismissed,
} from '../homepageBanner'

const NOW = Date.parse('2026-10-30T12:00:00Z')

beforeEach(() => localStorage.clear())

describe('homepage banner dismissal', () => {
  it('is not dismissed until the user dismisses it', () => {
    expect(isHomepageBannerDismissed(NOW)).toBe(false)
  })

  it('stays dismissed for two weeks', () => {
    dismissHomepageBanner(NOW)
    expect(isHomepageBannerDismissed(NOW + 1)).toBe(true)
    expect(isHomepageBannerDismissed(NOW + HOMEPAGE_BANNER_SNOOZE_MS - 1)).toBe(true)
  })

  it('comes back once two weeks have passed', () => {
    dismissHomepageBanner(NOW)
    expect(isHomepageBannerDismissed(NOW + HOMEPAGE_BANNER_SNOOZE_MS)).toBe(false)
  })

  it('ignores a corrupted value', () => {
    localStorage.setItem(HOMEPAGE_BANNER_KEY, 'not-a-date')
    expect(isHomepageBannerDismissed(NOW)).toBe(false)
  })
})

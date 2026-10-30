/**
 * The "no homepage yet" banner can be dismissed. It is a nudge, not a setting,
 * so the dismissal lapses after two weeks rather than hiding it for good.
 */
export const HOMEPAGE_BANNER_KEY = 'homelable_docs_homepage_banner_dismissed'
export const HOMEPAGE_BANNER_SNOOZE_MS = 14 * 24 * 60 * 60 * 1000

/** True while a dismissal younger than two weeks is on record. */
export function isHomepageBannerDismissed(now: number = Date.now()): boolean {
  try {
    const at = Number(localStorage.getItem(HOMEPAGE_BANNER_KEY))
    return Number.isFinite(at) && at > 0 && now - at < HOMEPAGE_BANNER_SNOOZE_MS
  } catch {
    return false
  }
}

export function dismissHomepageBanner(now: number = Date.now()): void {
  try {
    localStorage.setItem(HOMEPAGE_BANNER_KEY, String(now))
  } catch {
    // Without storage the banner simply comes back next visit.
  }
}

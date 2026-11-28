import { useSyncExternalStore } from 'react'

/**
 * The phone layout breakpoint. Tailwind's `md` is 768px, so everything below it
 * gets the drawer navigation, the compact toolbar and the bottom-sheet panels.
 */
export const MOBILE_QUERY = '(max-width: 767px)'

function subscribe(onChange: () => void): () => void {
  const mql = typeof window !== 'undefined' ? window.matchMedia?.(MOBILE_QUERY) : undefined
  if (!mql) return () => {}
  mql.addEventListener('change', onChange)
  return () => mql.removeEventListener('change', onChange)
}

function snapshot(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia?.(MOBILE_QUERY).matches ?? false
}

/** True below the `md` breakpoint. Re-renders when the window crosses it. */
export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false)
}

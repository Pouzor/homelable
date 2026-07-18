/**
 * Getting Started walkthrough — persisted invite state (localStorage).
 *
 * Mirrors the autosaveSettings.ts pattern: a `homelable.<name>` key plus a
 * `window` CustomEvent for same-tab sync, so App and SettingsModal stay aligned
 * without a global store.
 *
 * `seenVersion` is stamped with WALKTHROUGH_VERSION when the user finishes or
 * dismisses the tour. Bump WALKTHROUGH_VERSION whenever new steps ship so
 * existing users are re-offered the tour exactly once (they may have missed the
 * new features). A brand-new user starts at seenVersion=null and is offered too.
 */
export const WALKTHROUGH_VERSION = 1

export type WalkthroughStatus = 'pending' | 'skipped' | 'completed'

export interface WalkthroughState {
  seenVersion: number | null
  status: WalkthroughStatus
}

const KEY = 'homelable.walkthrough'
const EVENT = 'homelable:walkthrough-changed'

export const DEFAULT_WALKTHROUGH_STATE: WalkthroughState = { seenVersion: null, status: 'pending' }

function isStatus(v: unknown): v is WalkthroughStatus {
  return v === 'pending' || v === 'skipped' || v === 'completed'
}

export function readWalkthrough(): WalkthroughState {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULT_WALKTHROUGH_STATE }
    const parsed = JSON.parse(raw) as Partial<WalkthroughState>
    return {
      seenVersion: typeof parsed.seenVersion === 'number' ? parsed.seenVersion : null,
      status: isStatus(parsed.status) ? parsed.status : 'pending',
    }
  } catch {
    return { ...DEFAULT_WALKTHROUGH_STATE }
  }
}

export function writeWalkthrough(state: WalkthroughState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
    window.dispatchEvent(new CustomEvent(EVENT, { detail: state }))
  } catch {
    // ignore quota / SSR
  }
}

export function subscribeWalkthrough(listener: (s: WalkthroughState) => void): () => void {
  const handler = (e: Event) => listener((e as CustomEvent<WalkthroughState>).detail)
  window.addEventListener(EVENT, handler)
  return () => window.removeEventListener(EVENT, handler)
}

/** True when the invite should be offered (new user, or upgraded past the last seen version). */
export function shouldOfferWalkthrough(state: WalkthroughState = readWalkthrough()): boolean {
  return state.seenVersion !== WALKTHROUGH_VERSION
}

/** Stamp the current version so the invite stops auto-showing until the next bump. */
export function markWalkthroughSeen(status: Exclude<WalkthroughStatus, 'pending'>): void {
  writeWalkthrough({ seenVersion: WALKTHROUGH_VERSION, status })
}

/** Clear the stamp so the tour is offered again (used by "Restart" in Settings). */
export function resetWalkthrough(): void {
  writeWalkthrough({ ...DEFAULT_WALKTHROUGH_STATE })
}

// Persisted client-side preference for masking IP addresses on the canvas.
// Kept in localStorage (per-user UI preference, not canvas data) so it
// survives a page reload.

const KEY = 'homelable.hideIp'

export function readHideIp(): boolean {
  try {
    return localStorage.getItem(KEY) === 'true'
  } catch {
    return false
  }
}

export function writeHideIp(value: boolean): void {
  try {
    localStorage.setItem(KEY, String(value))
  } catch {
    /* quota / SSR */
  }
}

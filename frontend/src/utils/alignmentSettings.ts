// Persisted client-side settings for alignment guides.
// Kept in localStorage (per-user UI preference, not canvas data).
// Same-tab updates propagate via a CustomEvent so the drag hook and the
// settings panel can stay in sync without a global store.

export interface AlignmentSettings {
  enabled: boolean
  threshold: number
}

export const DEFAULT_ALIGNMENT_SETTINGS: AlignmentSettings = { enabled: true, threshold: 6 }

const KEY = 'homelable.alignmentGuides'
const EVENT = 'homelable:alignment-settings-changed'

export function readAlignmentSettings(): AlignmentSettings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULT_ALIGNMENT_SETTINGS
    const parsed = JSON.parse(raw) as Partial<AlignmentSettings>
    return {
      enabled: parsed.enabled ?? DEFAULT_ALIGNMENT_SETTINGS.enabled,
      threshold: typeof parsed.threshold === 'number' ? parsed.threshold : DEFAULT_ALIGNMENT_SETTINGS.threshold,
    }
  } catch {
    return DEFAULT_ALIGNMENT_SETTINGS
  }
}

export function writeAlignmentSettings(s: AlignmentSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
    window.dispatchEvent(new CustomEvent<AlignmentSettings>(EVENT, { detail: s }))
  } catch {
    /* quota / SSR */
  }
}

export function subscribeAlignmentSettings(listener: (s: AlignmentSettings) => void): () => void {
  const handler = (e: Event) => listener((e as CustomEvent<AlignmentSettings>).detail)
  window.addEventListener(EVENT, handler)
  return () => window.removeEventListener(EVENT, handler)
}

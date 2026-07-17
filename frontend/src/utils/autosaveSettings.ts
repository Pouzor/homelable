// Persisted client-side autosave preference.
// Kept in localStorage (per-user UI preference, not canvas data).
// Same-tab updates propagate via a CustomEvent so App.tsx and SettingsModal
// can stay in sync without a global store.

export interface AutosaveSettings {
  enabled: boolean
  delay: number // seconds of inactivity before auto-saving
}

export const DEFAULT_AUTOSAVE_SETTINGS: AutosaveSettings = { enabled: false, delay: 5 }

const KEY = 'homelable.autosave'
const EVENT = 'homelable:autosave-settings-changed'

export function readAutosaveSettings(): AutosaveSettings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULT_AUTOSAVE_SETTINGS
    const parsed = JSON.parse(raw) as Partial<AutosaveSettings>
    return {
      enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : DEFAULT_AUTOSAVE_SETTINGS.enabled,
      delay: typeof parsed.delay === 'number' && parsed.delay > 0 ? parsed.delay : DEFAULT_AUTOSAVE_SETTINGS.delay,
    }
  } catch {
    return DEFAULT_AUTOSAVE_SETTINGS
  }
}

export function writeAutosaveSettings(s: AutosaveSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
    window.dispatchEvent(new CustomEvent<AutosaveSettings>(EVENT, { detail: s }))
  } catch {
    /* quota / SSR */
  }
}

export function subscribeAutosaveSettings(listener: (s: AutosaveSettings) => void): () => void {
  const handler = (e: Event) => listener((e as CustomEvent<AutosaveSettings>).detail)
  window.addEventListener(EVENT, handler)
  return () => window.removeEventListener(EVENT, handler)
}

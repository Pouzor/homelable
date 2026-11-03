// Persisted client-side setting for the canvas hover highlight (dim what is
// not linked to the hovered node). Kept in localStorage (per-user UI
// preference, not canvas data). Same-tab updates propagate via a CustomEvent so
// the canvas and the settings panel stay in sync without a global store.

export interface HoverHighlightSettings {
  enabled: boolean
}

export const DEFAULT_HOVER_HIGHLIGHT_SETTINGS: HoverHighlightSettings = { enabled: true }

const KEY = 'homelable.hoverHighlight'
const EVENT = 'homelable:hover-highlight-settings-changed'

export function readHoverHighlightSettings(): HoverHighlightSettings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULT_HOVER_HIGHLIGHT_SETTINGS
    const parsed = JSON.parse(raw) as Partial<HoverHighlightSettings>
    return {
      enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : DEFAULT_HOVER_HIGHLIGHT_SETTINGS.enabled,
    }
  } catch {
    return DEFAULT_HOVER_HIGHLIGHT_SETTINGS
  }
}

export function writeHoverHighlightSettings(s: HoverHighlightSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
    window.dispatchEvent(new CustomEvent<HoverHighlightSettings>(EVENT, { detail: s }))
  } catch {
    /* quota / SSR */
  }
}

export function subscribeHoverHighlightSettings(listener: (s: HoverHighlightSettings) => void): () => void {
  const handler = (e: Event) => listener((e as CustomEvent<HoverHighlightSettings>).detail)
  window.addEventListener(EVENT, handler)
  return () => window.removeEventListener(EVENT, handler)
}

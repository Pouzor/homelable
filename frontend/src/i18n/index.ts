import { useSyncExternalStore } from 'react'
import {
  t,
  getLocale,
  getSnapshot,
  setLocale,
  subscribe,
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_LABELS,
  type Locale,
  type Vars,
  type I18nSnapshot,
} from './core'

export {
  t,
  getLocale,
  getSnapshot,
  setLocale,
  subscribe,
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_LABELS,
}
export type { Locale, Vars, I18nSnapshot }
export { setLocaleForTest, registerDictionary } from './core'

/**
 * Current locale plus a re-rendering `t`. Call this in any component that shows
 * translated text, so it repaints when the language changes:
 *
 *   const { t } = useI18n()
 *   <button title={t('Undo (Ctrl+Z)')}>…</button>
 *
 * The returned object keeps a stable identity until the locale actually changes
 * — see the note on I18nSnapshot in ./core.ts for why that matters to the React
 * Compiler.
 */
export function useI18n(): I18nSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/**
 * Subscribe to locale changes without pulling in `t`. For a component that
 * imports `t` at module scope — the exhaustive-deps rule already treats a module
 * import as stable, so it stays out of the hook dependency arrays — and only
 * needs to know when to repaint.
 */
export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, getLocale, getLocale)
}

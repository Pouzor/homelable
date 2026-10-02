/**
 * Minimal i18n runtime.
 *
 * Design notes — read before changing anything here:
 *
 * 1. **English source text is the key.** `t('Save')` looks up `'Save'` and falls
 *    back to `'Save'` when no translation exists, so English output is
 *    byte-identical to the hardcoded strings this replaced. That is what keeps
 *    the ~190 existing test files green without touching a single assertion,
 *    and it keeps future merges from upstream small: wrapping a literal in `t()`
 *    is a one-line change that conflicts rarely.
 *
 * 2. **No React context.** State lives in a module-level variable and components
 *    subscribe via `useSyncExternalStore` (see `useI18n` in ./index.ts). A context
 *    provider would have to wrap the tree, and the test suite renders components
 *    bare in ~190 files — a missing provider would throw in every one of them.
 *    Stores and plain `utils/` modules call `t()` directly, outside React.
 *
 * 3. **English is the default.** `localStorage` wins, then a `zh*` browser
 *    language, then English. jsdom reports `en-US`, so tests are deterministic.
 */

import zhCN from './locales/zh-CN'

export const LOCALES = ['en', 'zh-CN'] as const
export type Locale = (typeof LOCALES)[number]

export const DEFAULT_LOCALE: Locale = 'en'

/** Each language in its own script — an English reader cannot read 简体中文. */
export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  'zh-CN': '简体中文',
}

const STORAGE_KEY = 'homelable.locale'

/** Interpolation values. Missing keys are left as-is rather than blanked. */
export type Vars = Record<string, string | number>

function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value)
}

// English is the key, so its dictionary is intentionally empty: the fallback in
// `t()` *is* the English translation.
const dictionaries: Record<Locale, Record<string, string>> = {
  en: {},
  'zh-CN': zhCN,
}

let current: Locale = DEFAULT_LOCALE
const listeners = new Set<() => void>()

function readStored(): Locale | null {
  try {
    const saved = globalThis.localStorage?.getItem(STORAGE_KEY)
    return isLocale(saved) ? saved : null
  } catch {
    // Private mode / disabled storage: fall through to language detection.
    return null
  }
}

function detectLocale(): Locale {
  const stored = readStored()
  if (stored) return stored
  const nav =
    typeof navigator !== 'undefined' && typeof navigator.language === 'string'
      ? navigator.language
      : ''
  return /^zh\b/i.test(nav) ? 'zh-CN' : DEFAULT_LOCALE
}

function applyDocumentLang(locale: Locale) {
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.lang = locale
  }
}

/**
 * Translate `key` into the active locale.
 *
 * `key` is the English source text, so `t('Save')` is a no-op in English and
 * renders 保存 in zh-CN. `{name}` placeholders are interpolated from `vars`; a
 * translation is free to drop a placeholder it has no use for (English plural
 * suffixes, most often — see the `{plural}` convention in zh-CN.ts).
 */
export function t(key: string, vars?: Vars): string {
  const translated = dictionaries[current][key]
  // A blank or whitespace-only entry is treated as absent: it would otherwise
  // render an invisible label, which is worse than showing the English source.
  const out = typeof translated === 'string' && translated.trim() ? translated : key
  if (!vars) return out
  return out.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = vars[name]
    return value === undefined ? match : String(value)
  })
}

export function getLocale(): Locale {
  return current
}

/** Persist and broadcast a locale change. Re-setting the current one is a no-op. */
export function setLocale(next: Locale): void {
  // Validate: an unsupported value would leave the app in a locale that has no
  // dictionary, so every lookup silently fell back to English anyway — only the
  // switcher would be lying about the state.
  if (!isLocale(next)) return
  if (next === current) return
  current = next
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, next)
  } catch {
    // Non-fatal: the choice still applies for this session.
  }
  applyDocumentLang(next)
  rebuildSnapshot()
  for (const notify of listeners) notify()
}

/** Test hook: install a locale without touching storage or the DOM. */
export function setLocaleForTest(next: Locale): void {
  if (!isLocale(next)) return
  current = next
  rebuildSnapshot()
  for (const notify of listeners) notify()
}

/** Register a listener; returns the unsubscribe function. */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Register a dictionary at runtime (used by the locale modules and tests). */
export function registerDictionary(locale: Locale, entries: Record<string, string>): void {
  Object.assign(dictionaries[locale], entries)
}

export interface I18nSnapshot {
  t: typeof t
  locale: Locale
  setLocale: typeof setLocale
}

/**
 * The object handed to components, rebuilt only when the locale actually changes
 * and then frozen.
 *
 * Returning a fresh `{ t, locale, setLocale }` literal from every render looks
 * equivalent but is not: the React Compiler sees an unstable value flowing into
 * the component and then into its hand-written useCallback/useMemo, gives up on
 * preserving that memoization, and bails out with
 * `react-hooks/preserve-manual-memoization` — a hard lint error, and a silent
 * perf regression in the real build. A stable reference keeps the compiler happy
 * and is what useSyncExternalStore wants anyway.
 */
let snapshot: I18nSnapshot = Object.freeze({ t, locale: current, setLocale })

function rebuildSnapshot(): void {
  snapshot = Object.freeze({ t, locale: current, setLocale })
}

export function getSnapshot(): I18nSnapshot {
  return snapshot
}

// Initialise on first import so a bare `t()` call in a store or util works before
// any component mounts.
current = detectLocale()
rebuildSnapshot()
applyDocumentLang(current)

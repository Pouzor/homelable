import fs from 'node:fs'
import path from 'node:path'
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  t,
  getLocale,
  setLocale,
  setLocaleForTest,
  registerDictionary,
  useI18n,
  useLocale,
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_LABELS,
} from '../index'
import zhCN from '../locales/zh-CN'
import { LanguageSwitcher } from '../LanguageSwitcher'

// core.ts and index.ts document the API with `t('…')` examples in comments, so
// scanning them would invent keys that are never rendered. The switcher is kept
// in scope: its `t('Language')` is real. The dictionary is data and holds no call
// sites at all, only doc examples.
const SCAN_SKIP = new Set([path.resolve(__dirname, '../core.ts'), path.resolve(__dirname, '../index.ts')])
const SCAN_SKIP_DIRS = new Set([path.resolve(__dirname, '../locales')])

function resetLocale() {
  setLocaleForTest(DEFAULT_LOCALE)
}

afterEach(() => {
  resetLocale()
})

describe('i18n core', () => {
  it('falls back to the key itself, so English output never changes', () => {
    resetLocale()
    expect(getLocale()).toBe('en')
    // Nothing is registered for English: the source string *is* the translation.
    expect(t('Save')).toBe('Save')
    expect(t('A string with no translation at all')).toBe('A string with no translation at all')
  })

  it('translates a registered key in zh-CN', () => {
    registerDictionary('zh-CN', { 'Save': '保存' })
    setLocaleForTest('zh-CN')
    expect(t('Save')).toBe('保存')
  })

  it('falls back to English for a key the dictionary is missing', () => {
    setLocaleForTest('zh-CN')
    expect(t('Not translated yet')).toBe('Not translated yet')
  })

  it('never renders a blank string for an empty or whitespace-only entry', () => {
    registerDictionary('zh-CN', { 'Empty one': '', 'Blank one': '   ' })
    setLocaleForTest('zh-CN')
    expect(t('Empty one')).toBe('Empty one')
    expect(t('Blank one')).toBe('Blank one')
  })

  it('interpolates {name} placeholders', () => {
    registerDictionary('zh-CN', { 'Moved {count} devices into {zone}': '已将 {count} 台设备移入 {zone}' })
    setLocaleForTest('zh-CN')
    expect(t('Moved {count} devices into {zone}', { count: 3, zone: 'Rack 1' })).toBe(
      '已将 3 台设备移入 Rack 1',
    )
  })

  it('leaves a placeholder in place when no value is supplied for it', () => {
    resetLocale()
    expect(t('Moved {count} devices')).toBe('Moved {count} devices')
  })

  it('lets a translation drop a placeholder it has no use for', () => {
    // The English plural-suffix convention: Chinese has no plural form, so the
    // translation simply omits {plural} and the text reads correctly.
    registerDictionary('zh-CN', {
      'Imported {count} node{plural}': '已导入 {count} 个节点',
    })
    setLocaleForTest('zh-CN')
    expect(t('Imported {count} node{plural}', { count: 1, plural: '' })).toBe('已导入 1 个节点')
    expect(t('Imported {count} node{plural}', { count: 5, plural: 's' })).toBe('已导入 5 个节点')
  })

  it('leaves text with literal braces alone when no vars are passed', () => {
    resetLocale()
    // Guard against a JSON/YAML example being treated as a placeholder.
    expect(t('Example: {"a": 1}')).toBe('Example: {"a": 1}')
  })

  it('persists the choice and mirrors it onto <html lang>', () => {
    act(() => setLocale('zh-CN'))
    expect(getLocale()).toBe('zh-CN')
    expect(globalThis.localStorage.getItem('homelable.locale')).toBe('zh-CN')
    expect(document.documentElement.lang).toBe('zh-CN')

    act(() => setLocale('en'))
    expect(globalThis.localStorage.getItem('homelable.locale')).toBe('en')
    expect(document.documentElement.lang).toBe('en')
  })

  it('ignores a value that is not a supported locale', () => {
    resetLocale()
    // Deliberately bypasses the type to model a hand-edited localStorage entry.
    act(() => setLocale('fr' as never))
    expect(getLocale()).toBe('en')
  })

  it('exposes English and Simplified Chinese, labelled in their own script', () => {
    expect([...LOCALES]).toEqual(['en', 'zh-CN'])
    // An English reader cannot read 简体中文, so each label is in its own script
    // rather than an English gloss of the other language.
    expect(LOCALE_LABELS.en).toBe('English')
    expect(LOCALE_LABELS['zh-CN']).toBe('简体中文')
  })
})

describe('useI18n', () => {
  it('re-renders when the locale changes, without a provider', () => {
    registerDictionary('zh-CN', { Probe: '探针' })
    render(<Probe />)
    expect(screen.getByTestId('label').textContent).toBe('Probe')

    act(() => setLocale('zh-CN'))
    expect(screen.getByTestId('label').textContent).toBe('探针')

    act(() => setLocale('en'))
    expect(screen.getByTestId('label').textContent).toBe('Probe')
  })
})

describe('LanguageSwitcher', () => {
  it('lists both languages and switches on change', async () => {
    registerDictionary('zh-CN', { 'Language': '语言' })
    render(<LanguageSwitcher />)
    const select = screen.getByLabelText('Language') as HTMLSelectElement
    expect(select.value).toBe('en')
    expect(screen.getByRole('option', { name: 'English' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '简体中文' })).toBeInTheDocument()

    act(() => {
      select.value = 'zh-CN'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(getLocale()).toBe('zh-CN')
    expect(select.value).toBe('zh-CN')
  })
})

/**
 * Completeness gate. English-as-key means an untranslated key silently renders
 * English, so nothing in the suite would ever fail over a missing entry. This
 * test is the only thing standing between a partial translation and a UI that
 * is half Chinese, so it walks the real source tree rather than trusting a
 * hand-maintained list.
 */
describe('zh-CN dictionary completeness', () => {
  const SRC_ROOT = path.resolve(__dirname, '../..')

  // The unit tests above call registerDictionary(), which mutates the imported
  // zh-CN object in place. Reload the module in a fresh registry so these checks
  // read the dictionary exactly as it exists in the file, not as the test run
  // left it.
  let fileDict: Record<string, string> = zhCN
  beforeAll(async () => {
    vi.resetModules()
    fileDict = (await import('../locales/zh-CN')).default
  })

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue
        if (SCAN_SKIP_DIRS.has(full)) continue
        walk(full, out)
      } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) {
        if (!SCAN_SKIP.has(full)) out.push(full)
      }
    }
    return out
  }

  /** Keys passed as the first argument of t() anywhere in the source tree. */
  function collectKeys(): { used: Set<string>; missing: string[]; dynamic: string[] } {
    const files = walk(SRC_ROOT)
    const used = new Set<string>()
    const missing: string[] = []
    const dynamic: string[] = []
    // t('key') / t("key") / t(`key`) — first argument only.
    const call = /\bt\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g

    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8')
      for (const m of source.matchAll(call)) {
        const [, quote, body] = m
        if (quote === '`' && body.includes('${')) {
          dynamic.push(`${path.relative(SRC_ROOT, file)}: ${body}`)
          continue
        }
        const key = body.replace(/\\'/g, "'").replace(/\\"/g, '"')
        if (!key) continue
        used.add(key)
        if (!Object.prototype.hasOwnProperty.call(fileDict, key)) {
          missing.push(`${path.relative(SRC_ROOT, file)}: ${key}`)
        }
      }
    }
    return { used, missing, dynamic }
  }

  it('has no empty translation values', () => {
    const bad = Object.entries(fileDict)
      .filter(([, v]) => !v.trim())
      .map(([k]) => k)
    expect(bad).toEqual([])
  })

  it('scans a real source tree, not an empty one', () => {
    // Guards the two scans below: a broken path would report zero files and make
    // every assertion pass vacuously.
    expect(walk(SRC_ROOT).length).toBeGreaterThan(100)
  })

  it('defines a translation for every t() key used in the source', () => {
    const { missing, dynamic } = collectKeys()
    // Keys built at runtime cannot be checked statically; they are listed here so
    // a reviewer can confirm each one resolves, rather than passing unnoticed.
    expect(missing, `Untranslated t() keys:\n${missing.join('\n')}`).toEqual([])
    expect(dynamic, `Dynamic t() keys need a manual look:\n${dynamic.join('\n')}`).toEqual([])
  })

  it('has no translation for a key the code no longer uses', () => {
    // Guards the opposite drift: a stale entry is dead weight and hides the fact
    // that its source string was reworded, which would silently untranslate it.
    const { used } = collectKeys()
    const stale = Object.keys(fileDict).filter((k) => !used.has(k))
    expect(stale, `Stale zh-CN entries:\n${stale.join('\n')}`).toEqual([])
  })

  it('translates a shared English string the same way in every part', async () => {
    // The same source string turns up in several files, and the work was split
    // across parts. Spreading the parts would silently keep only the last
    // definition, so two parts disagreeing is a real (and invisible) defect.
    const partNames = [
      'root',
      'components-modals-1',
      'components-modals-2',
      'components-panels',
      'components-integrations',
      'documentation',
      'rack',
    ]
    const seen = new Map<string, Map<string, string>>() // key -> value -> part
    for (const name of partNames) {
      const mod = (await import(`../locales/parts/${name}`)) as { default: Record<string, string> }
      for (const [key, value] of Object.entries(mod.default)) {
        if (!seen.has(key)) seen.set(key, new Map())
        seen.get(key)!.set(value, name)
      }
    }

    const conflicts: string[] = []
    for (const [key, byValue] of seen) {
      if (byValue.size > 1) {
        conflicts.push(
          `${key}\n    ${[...byValue].map(([v, p]) => `${p}: ${v}`).join('\n    ')}`,
        )
      }
    }
    expect(conflicts, `Parts disagree on a translation:\n${conflicts.join('\n')}`).toEqual([])
  })
})

function Probe() {
  const { t } = useI18n()
  return <span data-testid="label">{t('Probe')}</span>
}

describe('the app-wide usage pattern', () => {
  // Every component in the app imports `t` at module scope and calls
  // `useLocale()` purely to repaint. That split exists so the React Compiler
  // keeps the hand-written memoization (see I18nSnapshot in ../core.ts), so it
  // is worth pinning down: a module-level `t` must still repaint on its own.
  function ModuleScopedProbe() {
    useLocale()
    return <span data-testid="label">{t('Probe')}</span>
  }

  it('repaints a component that imports t at module scope', () => {
    registerDictionary('zh-CN', { Probe: '探针' })
    render(<ModuleScopedProbe />)
    expect(screen.getByTestId('label').textContent).toBe('Probe')

    act(() => setLocale('zh-CN'))
    expect(screen.getByTestId('label').textContent).toBe('探针')

    act(() => setLocale('en'))
    expect(screen.getByTestId('label').textContent).toBe('Probe')
  })

  it('keeps the useI18n() return value identical until the locale changes', () => {
    // An unstable object here makes the React Compiler bail out of every
    // hand-written useCallback in the component, which eslint reports as
    // `react-hooks/preserve-manual-memoization`.
    const seen: unknown[] = []
    function Identity({ tag }: { tag: number }) {
      seen.push(useI18n())
      return <span>{tag}</span>
    }
    const { rerender } = render(<Identity tag={1} />)
    rerender(<Identity tag={2} />)
    expect(seen.length).toBeGreaterThanOrEqual(2)
    expect(seen[0]).toBe(seen[1])

    act(() => setLocale('zh-CN'))
    const afterSwitch = seen[seen.length - 1]
    expect(afterSwitch).not.toBe(seen[0])
    expect(afterSwitch).toMatchObject({ locale: 'zh-CN' })

    // And it stays stable again under a plain re-render.
    rerender(<Identity tag={3} />)
    expect(seen[seen.length - 1]).toBe(afterSwitch)
  })
})

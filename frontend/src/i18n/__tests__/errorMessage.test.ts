import { describe, it, expect, afterEach } from 'vitest'
import { errorMessage } from '../errorMessage'
import { setLocaleForTest, DEFAULT_LOCALE, LOCALES } from '../index'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

afterEach(() => setLocaleForTest(DEFAULT_LOCALE))

/** A rejection shaped like axios', which is what the API client throws. */
function apiRejection(detail: unknown) {
  return { response: { data: { detail } } }
}

describe('errorMessage', () => {
  it('translates a detail the dictionary knows', () => {
    setLocaleForTest('zh-CN')
    expect(errorMessage(apiRejection('Device not found'), 'fallback')).toBe('未找到设备')
  })

  it('passes an unknown detail through in the language the server sent', () => {
    // English: the key is the fallback, so an unmapped message reads normally.
    expect(errorMessage(apiRejection('Something new upstream'), 'fallback')).toBe('Something new upstream')
    // Chinese: unknown keys degrade to the original rather than to a raw key.
    setLocaleForTest('zh-CN')
    expect(errorMessage(apiRejection('Something new upstream'), 'fallback')).toBe('Something new upstream')
  })

  it('uses the caller fallback when the server said nothing useful', () => {
    for (const bad of [undefined, null, '', '   ', {}, 42, new Error('boom')]) {
      expect(errorMessage(bad, 'Could not save')).toBe('Could not save')
    }
    setLocaleForTest('zh-CN')
    expect(errorMessage({ response: { data: {} } }, 'Could not save')).toBe('保存失败')
  })

  it('translates the caller fallback too', () => {
    setLocaleForTest('zh-CN')
    expect(errorMessage(new Error('network down'), 'Could not save')).toBe('保存失败')
  })

  it('does not throw on anything', () => {
    const hostile = [undefined, null, 0, '', [], () => {}, Symbol('x'), { a: { b: { c: 1 } } }]
    for (const h of hostile) {
      expect(() => errorMessage(h, 'x')).not.toThrow()
      expect(typeof errorMessage(h, 'x')).toBe('string')
    }
  })
})

describe('backend copy coverage', () => {
  // Every fixed `detail="…"` the API can send should have a translation, or the
  // reader gets English inside an otherwise Chinese error. Regenerate the key
  // list from backend/app/**\*.py when the backend changes.
  const BACKEND = path.resolve(__dirname, '../../../../backend/app')

  function backendDetails(dir: string, out: string[] = []): string[] {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) backendDetails(full, out)
      else if (e.name.endsWith('.py')) {
        for (const m of readFileSync(full, 'utf8').matchAll(/detail\s*=\s*"((?:[^"\\]|\\.)*)"/g)) {
          out.push(m[1])
        }
      }
    }
    return out
  }

  it('translates every fixed message the backend can return', () => {
    setLocaleForTest('zh-CN')
    const details = [...new Set(backendDetails(BACKEND))]
    expect(details.length).toBeGreaterThan(40)
    const untranslated = details.filter((d) => errorMessage(apiRejection(d), 'fallback') === d)
    expect(
      untranslated,
      `These API messages would surface in English:\n${untranslated.join('\n')}`,
    ).toEqual([])
  })

  it('registers both locales', () => {
    expect([...LOCALES]).toContain('zh-CN')
  })
})

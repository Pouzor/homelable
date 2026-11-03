import { describe, expect, it } from 'vitest'

import { textDir } from '../markdown/direction'

const text = (value: string) => ({ type: 'text', value })
const el = (tagName: string, ...children: object[]) => ({ type: 'element', tagName, children })

describe('textDir', () => {
  it('reads Hebrew, Arabic and Persian as right-to-left', () => {
    expect(textDir(el('p', text('שלום עולם')))).toBe('rtl')
    expect(textDir(el('p', text('مرحبا بالعالم')))).toBe('rtl')
    expect(textDir(el('p', text('سلام دنیا')))).toBe('rtl')
  })

  it('reads any other script as left-to-right', () => {
    expect(textDir(el('p', text('Hello world')))).toBe('ltr')
    expect(textDir(el('p', text('Привет')))).toBe('ltr')
    // Outside Latin / Greek / Cyrillic — a narrow letter class would miss it.
    expect(textDir(el('p', text('日本語 then שלום')))).toBe('ltr')
  })

  it('goes by the first strong character, past digits and punctuation', () => {
    expect(textDir(el('p', text('1. (42) — שלום Hello')))).toBe('rtl')
    expect(textDir(el('p', text('42: Hello שלום')))).toBe('ltr')
  })

  it('skips inline code, so a Hebrew line opening on code stays RTL', () => {
    expect(textDir(el('p', el('code', text('docker ps')), text(' מציג קונטיינרים')))).toBe('rtl')
    expect(textDir(el('pre', el('code', text('echo שלום'))))).toBeUndefined()
  })

  it('walks nested markup down to the first text', () => {
    const table = el('table', el('thead', el('tr', el('th', el('strong', text('שם'))), el('th', text('IP')))))
    expect(textDir(table)).toBe('rtl')
  })

  it('leaves a block without letters to inherit', () => {
    expect(textDir(el('p', text('192.168.1.1 — 42')))).toBeUndefined()
    expect(textDir(el('p'))).toBeUndefined()
    expect(textDir(undefined)).toBeUndefined()
  })
})

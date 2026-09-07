import { describe, expect, it } from 'vitest'

import { collapseDiff, diffLines, diffStat, type DiffLine } from '../diff'

const text = (lines: DiffLine[], kind: DiffLine['kind']) =>
  lines.filter((line) => line.kind === kind).map((line) => line.text)

describe('diffLines', () => {
  it('marks an unchanged body as all the same', () => {
    const body = 'one\ntwo\nthree'
    expect(diffLines(body, body).every((line) => line.kind === 'same')).toBe(true)
  })

  it('finds an inserted line', () => {
    const lines = diffLines('one\nthree', 'one\ntwo\nthree')
    expect(text(lines, 'add')).toEqual(['two'])
    expect(text(lines, 'del')).toEqual([])
  })

  it('finds a removed line', () => {
    const lines = diffLines('one\ntwo\nthree', 'one\nthree')
    expect(text(lines, 'del')).toEqual(['two'])
    expect(text(lines, 'add')).toEqual([])
  })

  it('reads a changed line as one removal and one addition', () => {
    const lines = diffLines('one\ntwo\nthree', 'one\nTWO\nthree')
    expect(text(lines, 'del')).toEqual(['two'])
    expect(text(lines, 'add')).toEqual(['TWO'])
  })

  it('keeps every line of both bodies', () => {
    const lines = diffLines('a\nb', 'a\nc\nd')
    expect(lines.map((line) => line.text)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('handles an empty body on either side', () => {
    expect(text(diffLines('', 'new'), 'add')).toEqual(['new'])
    expect(text(diffLines('old', ''), 'del')).toEqual(['old'])
  })

  it('degrades to a wholesale replacement rather than hanging on two huge bodies', () => {
    const before = Array.from({ length: 700 }, (_, i) => `before ${i}`).join('\n')
    const after = Array.from({ length: 700 }, (_, i) => `after ${i}`).join('\n')
    const lines = diffLines(before, after)
    expect(text(lines, 'del')).toHaveLength(700)
    expect(text(lines, 'add')).toHaveLength(700)
  })
})

describe('diffStat', () => {
  it('counts what changed', () => {
    expect(diffStat(diffLines('a\nb\nc', 'a\nB\nc\nd'))).toEqual({ added: 2, removed: 1 })
  })

  it('counts nothing for an identical body', () => {
    expect(diffStat(diffLines('a', 'a'))).toEqual({ added: 0, removed: 0 })
  })
})

describe('collapseDiff', () => {
  it('collapses a long unchanged run into a gap', () => {
    const before = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n')
    const after = before.replace('line 15', 'line fifteen')
    const rows = collapseDiff(diffLines(before, after))
    const gaps = rows.filter((row) => row.kind === 'gap')
    expect(gaps).toHaveLength(2)
    expect(rows.some((row) => row.kind === 'add' && row.text === 'line fifteen')).toBe(true)
  })

  it('keeps the lines around a change as context', () => {
    const rows = collapseDiff(diffLines('a\nb\nc\nd\ne', 'a\nb\nC\nd\ne'), 1)
    expect(rows.filter((row) => row.kind === 'same').map((row) => row.text)).toEqual(['b', 'd'])
  })

  it('says how many lines a gap hides', () => {
    const before = Array.from({ length: 20 }, (_, i) => `l${i}`).join('\n')
    const after = `${before}\nnew`
    const [gap] = collapseDiff(diffLines(before, after)).filter((row) => row.kind === 'gap')
    expect(gap).toMatchObject({ skipped: 17 })
    expect(gap.text).toBe('17 unchanged lines')
  })

  it('leaves a diff with no change as a single gap', () => {
    const rows = collapseDiff(diffLines('a\nb', 'a\nb'))
    expect(rows).toEqual([{ kind: 'gap', text: '2 unchanged lines', skipped: 2 }])
  })
})

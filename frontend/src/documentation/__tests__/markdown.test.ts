import { describe, expect, it } from 'vitest'

import { extractToc, headingText, slugifyHeading } from '../markdown/toc'
import { isTaskLine, toggleTaskAtLine } from '../markdown/tasks'

describe('slugifyHeading', () => {
  it('matches what rehype-slug puts on the anchor', () => {
    expect(slugifyHeading('Device Information')).toBe('device-information')
    expect(slugifyHeading('Start / stop')).toBe('start--stop')
  })

  it('keeps letters outside ASCII', () => {
    expect(slugifyHeading('Réseau électrique')).toBe('réseau-électrique')
  })
})

describe('headingText', () => {
  it('strips the inline markup a heading can carry', () => {
    expect(headingText('**Bold** and `code`')).toBe('Bold and code')
    expect(headingText('[Link](https://example.com)')).toBe('Link')
    expect(headingText('[[device:nas-01|the NAS]]')).toBe('the NAS')
  })
})

describe('extractToc', () => {
  const body = [
    '---',
    'title: NAS',
    '---',
    '',
    '# nas-01',
    '',
    '## Device Information',
    '',
    '### Hardware',
    '',
    '#### Too deep',
    '',
    '## Services',
  ].join('\n')

  it('takes h2 and h3 by default, skipping h1 and deeper', () => {
    expect(extractToc(body).map((e) => e.text)).toEqual([
      'Device Information',
      'Hardware',
      'Services',
    ])
  })

  it('records the level so the rail can indent', () => {
    expect(extractToc(body).map((e) => e.level)).toEqual([2, 3, 2])
  })

  it('ignores headings inside a fenced code block', () => {
    const fenced = '## Real\n\n```\n## Not a heading\n```\n\n## Also real'
    expect(extractToc(fenced).map((e) => e.text)).toEqual(['Real', 'Also real'])
  })

  it('suffixes a repeated heading the way rehype-slug does', () => {
    expect(extractToc('## Notes\n\n## Notes').map((e) => e.id)).toEqual(['notes', 'notes-1'])
  })

  it('is empty for a body with no headings', () => {
    expect(extractToc('just text')).toEqual([])
  })
})

describe('toggleTaskAtLine', () => {
  const body = ['- [ ] first', '- [x] second', 'not a task'].join('\n')

  it('ticks an unticked task', () => {
    expect(toggleTaskAtLine(body, 1).split('\n')[0]).toBe('- [x] first')
  })

  it('unticks a ticked task', () => {
    expect(toggleTaskAtLine(body, 2).split('\n')[1]).toBe('- [ ] second')
  })

  it('leaves every other line exactly as it was', () => {
    const lines = toggleTaskAtLine(body, 1).split('\n')
    expect(lines[1]).toBe('- [x] second')
    expect(lines[2]).toBe('not a task')
  })

  it('handles indented and numbered tasks', () => {
    expect(toggleTaskAtLine('  - [ ] nested', 1)).toBe('  - [x] nested')
    expect(toggleTaskAtLine('1. [ ] numbered', 1)).toBe('1. [x] numbered')
  })

  it('does nothing when the line is not a task or is out of range', () => {
    expect(toggleTaskAtLine(body, 3)).toBe(body)
    expect(toggleTaskAtLine(body, 99)).toBe(body)
    expect(toggleTaskAtLine(body, 0)).toBe(body)
  })

  it('is its own inverse', () => {
    expect(toggleTaskAtLine(toggleTaskAtLine(body, 1), 1)).toBe(body)
  })
})

describe('isTaskLine', () => {
  it('recognises the shapes remark-gfm treats as tasks', () => {
    expect(isTaskLine('- [ ] a')).toBe(true)
    expect(isTaskLine('* [x] a')).toBe(true)
    expect(isTaskLine('- a')).toBe(false)
  })
})

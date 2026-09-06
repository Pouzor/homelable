import { describe, expect, it } from 'vitest'

import {
  isOverdue,
  parseFrontmatter,
  reviewInterval,
  summaryOf,
  tagsOf,
  withFrontmatter,
  withTags,
} from '../frontmatter'

describe('parseFrontmatter', () => {
  it('reads the leading block and strips it from the content', () => {
    const { data, content } = parseFrontmatter('---\ntitle: NAS\ntags: [a, b]\n---\n\n# NAS\n')
    expect(data).toEqual({ title: 'NAS', tags: ['a', 'b'] })
    expect(content.trim()).toBe('# NAS')
  })

  it('ignores a block that is not the first thing in the body', () => {
    const body = '# Title\n\n---\ntitle: NAS\n---\n'
    expect(parseFrontmatter(body)).toEqual({ data: {}, content: body })
  })

  it('leaves the body alone when there is no block', () => {
    expect(parseFrontmatter('# Just a heading')).toEqual({ data: {}, content: '# Just a heading' })
  })

  it('treats malformed YAML as absent rather than failing', () => {
    // The user is mid-edit; the document still has to render.
    const { data, content } = parseFrontmatter('---\ntitle: [unclosed\n---\nbody')
    expect(data).toEqual({})
    expect(content).toBe('body')
  })

  it('ignores a block that parses to something that is not a mapping', () => {
    expect(parseFrontmatter('---\n- a\n- b\n---\nbody').data).toEqual({})
  })

  it('keeps a trailing space on the fence line', () => {
    expect(parseFrontmatter('--- \ntitle: NAS\n--- \n').data).toEqual({ title: 'NAS' })
  })

  it('stays linear on a block that was opened and never closed', () => {
    // What a document looks like while the block is being typed. With `\s*`
    // around the fences the closing alternative was reachable two ways, and
    // each added line multiplied the backtracking.
    const body = `---\n${'\n '.repeat(40_000)}`
    const started = performance.now()
    expect(parseFrontmatter(body).data).toEqual({})
    expect(performance.now() - started).toBeLessThan(1000)
  })

  it('handles CRLF line endings', () => {
    expect(parseFrontmatter('---\r\ntitle: NAS\r\n---\r\nbody').data).toEqual({ title: 'NAS' })
  })
})

describe('withTags', () => {
  it('replaces an inline list and leaves every other line as written', () => {
    const body = '---\ntitle: NAS\ntags: [old]\ncreated: 2026-09-07\n---\n\n# NAS\n'
    expect(withTags(body, ['a', 'b'])).toBe(
      '---\ntitle: NAS\ntags: [a, b]\ncreated: 2026-09-07\n---\n\n# NAS\n',
    )
  })

  it('replaces a block list with its items', () => {
    const body = '---\ntags:\n  - old\n  - older\nowner: me\n---\n\n# NAS\n'
    expect(withTags(body, ['a'])).toBe('---\ntags: [a]\nowner: me\n---\n\n# NAS\n')
  })

  it('adds the key to a block that has none', () => {
    expect(parseFrontmatter(withTags('---\ntitle: NAS\n---\n\n# NAS\n', ['a'])).data).toEqual({
      title: 'NAS',
      tags: ['a'],
    })
  })

  it('opens a block on a body that has none', () => {
    const next = withTags('# NAS', ['a'])
    expect(parseFrontmatter(next).data).toEqual({ tags: ['a'] })
    expect(parseFrontmatter(next).content.trim()).toBe('# NAS')
  })

  it('empties the list rather than dropping the key — the key is how tags are found', () => {
    expect(withTags('---\ntags: [a]\n---\n', [])).toBe('---\ntags: []\n---\n')
  })

  it('quotes a tag flow style would misread', () => {
    const next = withTags('---\ntitle: NAS\n---\n', ['needs: review', 'plain'])
    expect(parseFrontmatter(next).data.tags).toEqual(['needs: review', 'plain'])
  })
})

describe('withFrontmatter', () => {
  it('replaces an existing block, keeping the body', () => {
    const next = withFrontmatter('---\ntitle: Old\n---\n\n# Body\n', { title: 'New' })
    expect(parseFrontmatter(next).data).toEqual({ title: 'New' })
    expect(next).toContain('# Body')
  })

  it('adds a block to a body that has none', () => {
    const next = withFrontmatter('# Body', { title: 'New' })
    expect(next.startsWith('---\n')).toBe(true)
    expect(parseFrontmatter(next).content.trim()).toBe('# Body')
  })

  it('round-trips', () => {
    const data = { title: 'NAS', tags: ['storage', 'backup'], criticality: 'high' }
    expect(parseFrontmatter(withFrontmatter('# NAS', data)).data).toEqual(data)
  })
})

describe('tagsOf', () => {
  it('accepts a list, a comma string, and nothing', () => {
    expect(tagsOf({ tags: ['a', ' b '] })).toEqual(['a', 'b'])
    expect(tagsOf({ tags: 'a, b' })).toEqual(['a', 'b'])
    expect(tagsOf({ tags: 7 })).toEqual([])
    expect(tagsOf({})).toEqual([])
  })
})

describe('reviewInterval', () => {
  it('parses days, weeks, months and years', () => {
    const day = 24 * 60 * 60 * 1000
    expect(reviewInterval('30d')).toBe(30 * day)
    expect(reviewInterval('2w')).toBe(14 * day)
    expect(reviewInterval('6m')).toBe(180 * day)
    expect(reviewInterval('1y')).toBe(365 * day)
  })

  it('is null for anything it cannot read, which means never due', () => {
    expect(reviewInterval('soon')).toBeNull()
    expect(reviewInterval(undefined)).toBeNull()
    expect(reviewInterval('6')).toBeNull()
  })
})

describe('isOverdue', () => {
  const created = '2026-01-01T00:00:00Z'
  const now = Date.parse('2026-09-05T00:00:00Z')

  it('is false without a cadence', () => {
    expect(isOverdue({}, null, created, now)).toBe(false)
  })

  it('counts from the creation date when it has never been reviewed', () => {
    expect(isOverdue({ review_every: '1m' }, null, created, now)).toBe(true)
    expect(isOverdue({ review_every: '5y' }, null, created, now)).toBe(false)
  })

  it('counts from the last review once there is one', () => {
    expect(isOverdue({ review_every: '1m' }, '2026-09-01T00:00:00Z', created, now)).toBe(false)
  })
})

describe('summaryOf', () => {
  it('takes the first real line of prose', () => {
    expect(summaryOf('---\ntitle: NAS\n---\n\n# NAS\n\n> Holds every backup.\n')).toBe(
      'Holds every backup.',
    )
  })

  it('skips the generated placeholder rather than calling it a summary', () => {
    expect(summaryOf('# NAS\n\n> _One line: what this device is for._\n\nReal text.')).toBe('Real text.')
  })

  it('is empty when there is nothing but headings', () => {
    expect(summaryOf('# NAS\n\n## Services\n')).toBe('')
  })

  it('truncates a long line', () => {
    expect(summaryOf(`# T\n\n${'x'.repeat(400)}`, 20)).toHaveLength(20)
  })
})

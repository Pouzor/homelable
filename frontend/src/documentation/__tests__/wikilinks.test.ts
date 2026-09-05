import { describe, expect, it } from 'vitest'

import {
  backlinkIndex,
  collectWikiLinks,
  parseWikiLink,
  resolveWikiLink,
  splitWikiLinks,
  type LinkableDoc,
} from '../wikilinks'

const docs: LinkableDoc[] = [
  { id: 'd1', slug: 'nas-01', title: 'nas-01', device_id: 'dev-1' },
  { id: 'd2', slug: 'vlan-plan', title: 'VLAN plan' },
  { id: 'd3', slug: 'garage', title: 'Garage', node_id: 'node-9' },
]
const devices = [{ id: 'dev-1', label: 'nas-01' }]

describe('parseWikiLink', () => {
  it('reads a bare link as a document link', () => {
    expect(parseWikiLink('VLAN plan')).toEqual({
      target: 'doc',
      key: 'VLAN plan',
      label: 'VLAN plan',
      raw: '[[VLAN plan]]',
    })
  })

  it('reads the device, doc and node prefixes', () => {
    expect(parseWikiLink('device:nas-01')?.target).toBe('device')
    expect(parseWikiLink('doc:vlan-plan')?.target).toBe('doc')
    expect(parseWikiLink('node:node-9')?.target).toBe('node')
  })

  it('treats an unknown prefix as part of the key, not a target', () => {
    const link = parseWikiLink('https://example.com')
    expect(link?.target).toBe('doc')
    expect(link?.key).toBe('https://example.com')
  })

  it('takes the label after a pipe', () => {
    expect(parseWikiLink('device:nas-01|the NAS')?.label).toBe('the NAS')
  })

  it('is null for an empty link', () => {
    expect(parseWikiLink('')).toBeNull()
    expect(parseWikiLink('device:')).toBeNull()
  })
})

describe('splitWikiLinks', () => {
  it('splits text around a link, in order', () => {
    expect(splitWikiLinks('see [[device:nas-01]] now')).toEqual([
      { type: 'text', value: 'see ' },
      { type: 'link', link: expect.objectContaining({ key: 'nas-01' }) },
      { type: 'text', value: ' now' },
    ])
  })

  it('handles several links in one line', () => {
    const segments = splitWikiLinks('[[a]] and [[b]]')
    expect(segments.filter((s) => s.type === 'link')).toHaveLength(2)
  })

  it('leaves text with no link untouched', () => {
    expect(splitWikiLinks('plain')).toEqual([{ type: 'text', value: 'plain' }])
  })

  it('is reusable — the shared regex is reset between calls', () => {
    splitWikiLinks('[[a]]')
    expect(splitWikiLinks('[[a]]')).toHaveLength(1)
  })
})

describe('resolveWikiLink', () => {
  it('resolves a device by label to that device document', () => {
    const link = parseWikiLink('device:nas-01')!
    expect(resolveWikiLink(link, docs, devices)).toBe('d1')
  })

  it('resolves a device by id too', () => {
    const link = parseWikiLink('device:dev-1')!
    expect(resolveWikiLink(link, docs, devices)).toBe('d1')
  })

  it('resolves a document by slug, then by title', () => {
    expect(resolveWikiLink(parseWikiLink('doc:vlan-plan')!, docs)).toBe('d2')
    expect(resolveWikiLink(parseWikiLink('VLAN plan')!, docs)).toBe('d2')
  })

  it('is case-insensitive on titles and slugs', () => {
    expect(resolveWikiLink(parseWikiLink('vlan PLAN')!, docs)).toBe('d2')
  })

  it('resolves a node link to the document describing it', () => {
    expect(resolveWikiLink(parseWikiLink('node:node-9')!, docs)).toBe('d3')
  })

  it('is null when nothing matches, so the UI can offer to create it', () => {
    expect(resolveWikiLink(parseWikiLink('doc:nope')!, docs)).toBeNull()
    expect(resolveWikiLink(parseWikiLink('device:nope')!, docs, devices)).toBeNull()
  })

  it('is null for a device that exists but has no document yet', () => {
    const link = parseWikiLink('device:switch-core')!
    expect(resolveWikiLink(link, docs, [{ id: 'dev-2', label: 'switch-core' }])).toBeNull()
  })
})

describe('collectWikiLinks', () => {
  it('finds every link in a body', () => {
    expect(collectWikiLinks('a [[x]] b [[doc:y]]')).toHaveLength(2)
  })

  it('finds none in a body with none', () => {
    expect(collectWikiLinks('# Heading\n\nplain text')).toEqual([])
  })
})

describe('backlinkIndex', () => {
  it('maps a document to the documents that link to it', () => {
    const bodies = [
      { ...docs[0], body: 'see [[doc:vlan-plan]]' },
      { ...docs[1], body: 'no links' },
      { ...docs[2], body: 'also [[VLAN plan]]' },
    ]
    expect(backlinkIndex(bodies)).toEqual({ d2: ['d1', 'd3'] })
  })

  it('ignores a document linking to itself', () => {
    const bodies = [{ ...docs[1], body: 'see [[VLAN plan]]' }]
    expect(backlinkIndex(bodies)).toEqual({})
  })

  it('does not list the same source twice', () => {
    const bodies = [{ ...docs[0], body: '[[VLAN plan]] and [[doc:vlan-plan]]' }, { ...docs[1], body: '' }]
    expect(backlinkIndex(bodies)).toEqual({ d2: ['d1'] })
  })
})

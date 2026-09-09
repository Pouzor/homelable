/**
 * Downloading documentation.
 *
 * A page is written from the body the viewer already holds; the whole space
 * comes back from the server as a zip. Both end at the same anchor click, so
 * that is what these assert on.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { documentsApi } from '@/api/client'
import {
  docFilename,
  downloadAllDocs,
  downloadBlob,
  downloadDoc,
  filenameFromDisposition,
} from '../export'
import type { Doc } from '../types'

vi.mock('@/api/client', () => ({ documentsApi: { export: vi.fn() } }))

const exportAll = vi.mocked(documentsApi.export)

function makeDoc(overrides: Partial<Doc> = {}): Doc {
  return {
    id: 'doc-1',
    kind: 'page',
    title: 'VLAN plan',
    slug: 'vlan-plan',
    sort_order: 0,
    tags: [],
    frontmatter: {},
    starred: false,
    body: '---\ntags: [net]\n---\n\n# VLAN plan\n',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  } as Doc
}

/** What the browser was handed: the anchor's name and the blob behind it. */
let saved: { name: string; blob: Blob } | null = null
let revoked: string[] = []
let clicks = 0

beforeEach(() => {
  saved = null
  revoked = []
  clicks = 0
  let blob: Blob | null = null
  vi.spyOn(URL, 'createObjectURL').mockImplementation((value: Blob | MediaSource) => {
    blob = value as Blob
    return 'blob:doc'
  })
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url: string) => {
    revoked.push(url)
  })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicks += 1
    saved = { name: this.download, blob: blob as Blob }
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

// ── file names ──────────────────────────────────────────────────────────────

describe('docFilename', () => {
  it('is the slug with a markdown extension', () => {
    expect(docFilename(makeDoc())).toBe('vlan-plan.md')
  })

  it('falls back on the title when there is no slug', () => {
    expect(docFilename({ slug: '', title: 'Salle des machines' })).toBe('salle-des-machines.md')
  })

  it('cannot be turned into a path by a hand-edited title', () => {
    const name = docFilename({ slug: '../../etc/passwd', title: 'x' })
    expect(name).not.toContain('/')
    expect(name).not.toContain('..')
  })

  it('names an untitled document rather than producing a bare extension', () => {
    expect(docFilename({ slug: '', title: '   ' })).toBe('untitled.md')
  })
})

describe('filenameFromDisposition', () => {
  it('reads the quoted name the server sent', () => {
    expect(
      filenameFromDisposition('attachment; filename="homelable-documentation-20260909.zip"', 'x.zip'),
    ).toBe('homelable-documentation-20260909.zip')
  })

  it('reads an unquoted name', () => {
    expect(filenameFromDisposition('attachment; filename=docs.zip', 'x.zip')).toBe('docs.zip')
  })

  it('falls back when the header is missing', () => {
    expect(filenameFromDisposition(undefined, 'x.zip')).toBe('x.zip')
  })

  it('falls back when the header carries no filename', () => {
    expect(filenameFromDisposition('attachment', 'x.zip')).toBe('x.zip')
  })
})

// ── writing the file ────────────────────────────────────────────────────────

describe('downloadBlob', () => {
  it('clicks an anchor and releases the object URL', () => {
    downloadBlob(new Blob(['x']), 'a.md')
    expect(clicks).toBe(1)
    expect(saved?.name).toBe('a.md')
    expect(revoked).toEqual(['blob:doc'])
  })

  it('leaves no anchor behind in the document', () => {
    downloadBlob(new Blob(['x']), 'a.md')
    expect(document.querySelectorAll('a').length).toBe(0)
  })
})

describe('downloadDoc', () => {
  it('writes the body verbatim, frontmatter included', async () => {
    const doc = makeDoc()
    downloadDoc(doc)
    expect(await saved!.blob.text()).toBe(doc.body)
  })

  it('writes it as markdown under the document name', () => {
    downloadDoc(makeDoc())
    expect(saved?.name).toBe('vlan-plan.md')
    expect(saved?.blob.type).toContain('text/markdown')
  })

  it('writes an empty file rather than throwing on a body-less document', async () => {
    downloadDoc({ slug: 'empty', title: 'Empty', body: '' })
    expect(await saved!.blob.text()).toBe('')
  })

  it('asks the server for nothing — the body is already here', () => {
    downloadDoc(makeDoc())
    expect(exportAll).not.toHaveBeenCalled()
  })
})

// ── the whole space ─────────────────────────────────────────────────────────

describe('downloadAllDocs', () => {
  it('saves the archive under the name the server put on it', async () => {
    exportAll.mockResolvedValue({
      data: new Blob(['PK']),
      headers: { 'content-disposition': 'attachment; filename="homelable-documentation-20260909.zip"' },
    } as never)
    await downloadAllDocs()
    expect(saved?.name).toBe('homelable-documentation-20260909.zip')
    expect(saved?.blob.type).toBe('application/zip')
  })

  it('falls back on a plain name when the server sent no disposition', async () => {
    exportAll.mockResolvedValue({ data: new Blob(['PK']), headers: {} } as never)
    await downloadAllDocs()
    expect(saved?.name).toBe('homelable-documentation.zip')
  })

  it('rejects rather than saving an empty file when the request fails', async () => {
    exportAll.mockRejectedValue(new Error('500'))
    await expect(downloadAllDocs()).rejects.toThrow()
    expect(clicks).toBe(0)
  })
})

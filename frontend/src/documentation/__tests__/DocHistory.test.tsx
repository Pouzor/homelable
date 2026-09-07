/**
 * The two panels a document grew: the versions it used to have, and the
 * documents that point at it. Both existed in the API from the start and
 * neither had a way in, so what these assert first is that the wiring is there.
 */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import { DocViewer, type HistoryControls } from '../components/DocViewer'
import type { Doc, DocBacklink, DocRevision } from '../types'

function makeDoc(overrides: Partial<Doc> = {}): Doc {
  return {
    id: 'doc-1',
    kind: 'page',
    title: 'NAS',
    slug: 'nas',
    sort_order: 0,
    tags: [],
    frontmatter: {},
    starred: false,
    body: 'the current body\nsecond line',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  } as Doc
}

function revision(overrides: Partial<DocRevision> = {}): DocRevision {
  return {
    id: 'rev-1',
    document_id: 'doc-1',
    title: 'NAS',
    reason: 'edit',
    saved_at: '2026-01-01T00:00:00Z',
    size: 2048,
    ...overrides,
  }
}

function backlink(overrides: Partial<DocBacklink> = {}): DocBacklink {
  return {
    doc_id: 'doc-2',
    title: 'Backup runbook',
    kind: 'page',
    label: 'NAS',
    context: 'Runs nightly against [[NAS]].',
    count: 1,
    ...overrides,
  }
}

function controls(overrides: Partial<HistoryControls> = {}): HistoryControls {
  return {
    open: false,
    loading: false,
    revisions: [],
    preview: null,
    onToggle: vi.fn(),
    onSelect: vi.fn(),
    onClosePreview: vi.fn(),
    onRestore: vi.fn(),
    ...overrides,
  }
}

const base = {
  docs: [],
  devices: [],
  drifted: false,
  onEdit: vi.fn(),
  onToggleStar: vi.fn(),
  onMarkReviewed: vi.fn(),
  onRegenerate: vi.fn(),
  onDelete: vi.fn(),
  onOpenDoc: vi.fn(),
  onCreateFromLink: vi.fn(),
  onToggleTask: vi.fn(),
  onSetTags: vi.fn(),
}

describe('DocViewer — history', () => {
  it('offers no history when the host keeps none', () => {
    render(<DocViewer {...base} doc={makeDoc()} />)
    expect(screen.queryByLabelText('Version history')).toBeNull()
  })

  it('opens the rail from the header button', () => {
    const history = controls()
    render(<DocViewer {...base} doc={makeDoc()} history={history} />)

    fireEvent.click(screen.getByLabelText('Version history'))

    expect(history.onToggle).toHaveBeenCalled()
  })

  it('says the button is pressed while the rail is open', () => {
    render(<DocViewer {...base} doc={makeDoc()} history={controls({ open: true })} />)
    expect(screen.getByLabelText('Version history')).toHaveAttribute('aria-pressed', 'true')
  })

  it('lists a revision by what caused it, and selects it on click', () => {
    const history = controls({ open: true, revisions: [revision({ reason: 'regenerate' })] })
    render(<DocViewer {...base} doc={makeDoc()} history={history} />)

    fireEvent.click(screen.getByText('Regenerated'))

    expect(history.onSelect).toHaveBeenCalledWith('rev-1')
    expect(screen.getByText(/2 kB/)).toBeTruthy()
  })

  it('explains an empty history rather than showing an empty list', () => {
    render(<DocViewer {...base} doc={makeDoc()} history={controls({ open: true })} />)
    expect(screen.getByText(/No earlier version yet/)).toBeTruthy()
  })

  it('replaces the body with the version being read', () => {
    const history = controls({
      open: true,
      revisions: [revision()],
      preview: { revision: revision(), body: 'what it said before' },
    })
    render(<DocViewer {...base} doc={makeDoc()} history={history} />)

    expect(screen.getByText('what it said before')).toBeTruthy()
    expect(screen.queryByText(/the current body/)).toBeNull()
  })

  it('restores the version being read, and can go back to the current one', () => {
    const history = controls({
      open: true,
      revisions: [revision()],
      preview: { revision: revision(), body: 'what it said before' },
    })
    render(<DocViewer {...base} doc={makeDoc()} history={history} />)

    fireEvent.click(screen.getByText('Restore'))
    expect(history.onRestore).toHaveBeenCalledWith('rev-1')

    fireEvent.click(screen.getByLabelText('Back to the current version'))
    expect(history.onClosePreview).toHaveBeenCalled()
  })

  it('shows what changed since that version', () => {
    const history = controls({
      preview: { revision: revision(), body: 'the current body\nold second line' },
    })
    render(<DocViewer {...base} doc={makeDoc()} history={history} />)

    // The summary is on screen before anything is clicked: one line each way.
    expect(screen.getByText('+1')).toBeTruthy()
    expect(screen.getByText('−1')).toBeTruthy()

    fireEvent.click(screen.getByText('Changes'))

    expect(screen.getByText(/− old second line/)).toBeTruthy()
    expect(screen.getByText(/\+ second line/)).toBeTruthy()
  })

  it('says so when a version is identical to the current body', () => {
    const doc = makeDoc()
    const history = controls({ preview: { revision: revision(), body: doc.body } })
    render(<DocViewer {...base} doc={doc} history={history} />)

    expect(screen.getByText('Identical to the current version')).toBeTruthy()
  })
})

describe('DocViewer — backlinks', () => {
  it('lists what links here, with the line it links from', () => {
    render(<DocViewer {...base} doc={makeDoc()} backlinks={[backlink()]} />)

    expect(screen.getByText('Linked from (1)')).toBeTruthy()
    expect(screen.getByText('Backup runbook')).toBeTruthy()
    expect(screen.getByText('Runs nightly against [[NAS]].')).toBeTruthy()
  })

  it('opens the linking document', () => {
    const onOpenDoc = vi.fn()
    render(<DocViewer {...base} doc={makeDoc()} backlinks={[backlink()]} onOpenDoc={onOpenDoc} />)

    fireEvent.click(screen.getByText('Backup runbook'))

    expect(onOpenDoc).toHaveBeenCalledWith('doc-2')
  })

  it('counts repeated links from the same document once, and says how many', () => {
    render(<DocViewer {...base} doc={makeDoc()} backlinks={[backlink({ count: 3 })]} />)

    expect(screen.getAllByText('Backup runbook')).toHaveLength(1)
    expect(screen.getByText('×3')).toBeTruthy()
  })

  it('shows nothing at all when nothing links here', () => {
    render(<DocViewer {...base} doc={makeDoc()} backlinks={[]} />)
    expect(screen.queryByText(/Linked from/)).toBeNull()
  })

  it('waits for the answer rather than claiming nothing links here', () => {
    render(<DocViewer {...base} doc={makeDoc()} backlinks={[backlink()]} backlinksLoading />)
    expect(screen.queryByText(/Linked from/)).toBeNull()
  })
})

/**
 * The chips under a document title are its editor for tags: the frontmatter
 * key most documents never grow because nobody knows it is there.
 */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import { DocViewer } from '../components/DocViewer'
import type { Doc } from '../types'

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
    body: '---\ntitle: NAS\n---\n\n# NAS\n',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  } as Doc
}

const noop = {
  docs: [],
  devices: [],
  drifted: false,
  onEdit: vi.fn(),
  onToggleStar: vi.fn(),
  onMarkReviewed: vi.fn(),
  onRegenerate: vi.fn(),
  onDownload: vi.fn(),
  onDelete: vi.fn(),
  onOpenDoc: vi.fn(),
  onCreateFromLink: vi.fn(),
  onToggleTask: vi.fn(),
}

function addTag(text: string) {
  fireEvent.click(screen.getByText('Tag'))
  const input = screen.getByLabelText('New tag')
  fireEvent.change(input, { target: { value: text } })
  fireEvent.keyDown(input, { key: 'Enter' })
}

describe('DocViewer — tags', () => {
  it('adds a typed tag to the ones already there', () => {
    const onSetTags = vi.fn()
    render(<DocViewer {...noop} doc={makeDoc({ tags: ['prod'] })} onSetTags={onSetTags} />)
    addTag('backup')
    expect(onSetTags).toHaveBeenCalledWith(['prod', 'backup'])
  })

  it('takes a whole list from one field', () => {
    const onSetTags = vi.fn()
    render(<DocViewer {...noop} doc={makeDoc()} onSetTags={onSetTags} />)
    addTag(' web , prod ')
    expect(onSetTags).toHaveBeenCalledWith(['web', 'prod'])
  })

  it('does not add a tag the document already carries, whatever its case', () => {
    const onSetTags = vi.fn()
    render(<DocViewer {...noop} doc={makeDoc({ tags: ['Prod'] })} onSetTags={onSetTags} />)
    addTag('prod')
    expect(onSetTags).not.toHaveBeenCalled()
  })

  it('removes the tag whose chip was crossed out', () => {
    const onSetTags = vi.fn()
    render(<DocViewer {...noop} doc={makeDoc({ tags: ['prod', 'backup'] })} onSetTags={onSetTags} />)
    fireEvent.click(screen.getByLabelText('Remove tag prod'))
    expect(onSetTags).toHaveBeenCalledWith(['backup'])
  })

  it('writes nothing when the field is abandoned with Escape', () => {
    const onSetTags = vi.fn()
    render(<DocViewer {...noop} doc={makeDoc()} onSetTags={onSetTags} />)
    fireEvent.click(screen.getByText('Tag'))
    const input = screen.getByLabelText('New tag')
    fireEvent.change(input, { target: { value: 'backup' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onSetTags).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('New tag')).not.toBeInTheDocument()
  })

  it('offers the field back after a tag is added', () => {
    render(<DocViewer {...noop} doc={makeDoc()} onSetTags={vi.fn()} />)
    addTag('backup')
    expect(screen.getByText('Tag')).toBeInTheDocument()
  })
})

describe('DocViewer — read-only', () => {
  // The public documentation view renders this same component with no session
  // behind it. Every control that writes has to be gone, not merely disabled:
  // there is no endpoint to take the write.
  it('offers nothing that writes', () => {
    render(<DocViewer {...noop} readOnly doc={makeDoc({ tags: ['prod'] })} />)

    expect(screen.queryByText('Edit')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Delete this document')).not.toBeInTheDocument()
    expect(screen.queryByTitle('Delete this document')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Regenerate this document')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Tag' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Remove tag prod')).not.toBeInTheDocument()
    // The tag itself still reads — it is part of the document.
    expect(screen.getByText('#prod')).toBeInTheDocument()
  })

  it('still reads: the body and the download', () => {
    const onDownload = vi.fn()
    const doc = makeDoc({ body: '---\ntitle: NAS\n---\n\nIt lives in the shed.\n' })
    render(<DocViewer {...noop} readOnly doc={doc} onDownload={onDownload} />)

    expect(screen.getByText('It lives in the shed.')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Download this document'))
    expect(onDownload).toHaveBeenCalledTimes(1)
  })

  it('opens history but offers no restore', () => {
    const revision = {
      id: 'rev-1',
      document_id: 'doc-1',
      title: 'NAS',
      reason: 'edit' as const,
      saved_at: '2026-01-01T00:00:00Z',
      size: 12,
    }
    render(
      <DocViewer
        {...noop}
        readOnly
        doc={makeDoc()}
        history={{
          open: true,
          loading: false,
          revisions: [revision],
          preview: { revision, body: 'an older body' },
          onToggle: vi.fn(),
          onSelect: vi.fn(),
          onClosePreview: vi.fn(),
        }}
      />,
    )

    expect(screen.getByText('an older body')).toBeInTheDocument()
    expect(screen.queryByText('Restore')).not.toBeInTheDocument()
  })

  it('says a document is due for review without offering to mark it', () => {
    const doc = makeDoc({
      body: '---\ntitle: NAS\nreview_every: 1d\n---\n\n# NAS\n',
      created_at: '2020-01-01T00:00:00Z',
      reviewed_at: null,
    })
    render(<DocViewer {...noop} readOnly doc={doc} />)

    expect(screen.getByText(/Due for review/)).toBeInTheDocument()
    expect(screen.queryByText(/mark as reviewed/)).not.toBeInTheDocument()
  })
})

describe('DocViewer — download', () => {
  it('hands the open document to the host on click', () => {
    const onDownload = vi.fn()
    render(<DocViewer {...noop} doc={makeDoc()} onSetTags={vi.fn()} onDownload={onDownload} />)
    fireEvent.click(screen.getByLabelText('Download this document'))
    expect(onDownload).toHaveBeenCalledTimes(1)
  })

  // A folder hides Regenerate, and the two buttons sit side by side — the
  // download must not be hidden along with it.
  it('is offered for a folder too', () => {
    const onDownload = vi.fn()
    render(
      <DocViewer {...noop} doc={makeDoc({ kind: 'folder' })} onSetTags={vi.fn()} onDownload={onDownload} />,
    )
    expect(screen.queryByLabelText('Regenerate this document')).not.toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Download this document'))
    expect(onDownload).toHaveBeenCalledTimes(1)
  })
})

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

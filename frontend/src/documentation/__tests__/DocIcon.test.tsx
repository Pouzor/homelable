/**
 * A document's emoji: picked from the chip beside `+ Tag`, stored in the
 * `icon` column, and worn by its row in the tree in place of the kind icon.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { documentsApi } from '@/api/client'
import { DocTreeItem } from '../components/DocTree'
import { DocViewer } from '../components/DocViewer'
import { useDocsStore } from '../store'
import { buildDeviceTree, buildLibraryTree } from '../tree'
import type { Doc, DocumentSummary, TreeLeaf } from '../types'
import type { InventoryEntry } from '@/types'

vi.mock('@/api/client', () => ({
  documentsApi: { update: vi.fn() },
}))

const api = vi.mocked(documentsApi)

function summary(overrides: Partial<DocumentSummary> = {}): DocumentSummary {
  return {
    id: 'doc-1',
    kind: 'page',
    title: 'NAS',
    slug: 'nas',
    sort_order: 0,
    tags: [],
    frontmatter: {},
    starred: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function makeDoc(overrides: Partial<Doc> = {}): Doc {
  return { ...summary(), body: '---\ntitle: NAS\n---\n\n# NAS\n', ...overrides } as Doc
}

const viewerProps = {
  docs: [],
  devices: [],
  drifted: false,
  onDownload: vi.fn(),
  onOpenDoc: vi.fn(),
}

const rowProps = {
  depth: 1,
  activeId: null,
  expanded: [],
  starred: new Set<string>(),
  onSelect: vi.fn(),
  onToggle: vi.fn(),
}

const page: TreeLeaf = { id: 'doc-1', label: 'VLAN plan', kind: 'page', docId: 'doc-1', state: 'written' }

afterEach(cleanup)

describe('setIcon', () => {
  beforeEach(() => {
    api.update.mockReset()
    useDocsStore.setState({ docs: [], openDoc: null, loadError: null })
  })

  it('patches the icon and updates both the list and the open document', async () => {
    api.update.mockResolvedValue({ data: makeDoc({ icon: '🐳' }) } as never)
    useDocsStore.setState({ docs: [summary()], openDoc: makeDoc() })
    expect(await useDocsStore.getState().setIcon('doc-1', '🐳')).toBe(true)
    expect(api.update).toHaveBeenCalledWith('doc-1', { icon: '🐳' })
    expect(useDocsStore.getState().docs[0].icon).toBe('🐳')
    expect(useDocsStore.getState().openDoc?.icon).toBe('🐳')
  })

  it('sends null to clear it', async () => {
    api.update.mockResolvedValue({ data: makeDoc({ icon: null }) } as never)
    useDocsStore.setState({ docs: [summary({ icon: '🐳' })] })
    await useDocsStore.getState().setIcon('doc-1', null)
    expect(api.update).toHaveBeenCalledWith('doc-1', { icon: null })
    expect(useDocsStore.getState().docs[0].icon).toBeNull()
  })

  it('leaves another open document alone', async () => {
    api.update.mockResolvedValue({ data: makeDoc({ icon: '🐳' }) } as never)
    const other = makeDoc({ id: 'doc-2' })
    useDocsStore.setState({ docs: [summary()], openDoc: other })
    await useDocsStore.getState().setIcon('doc-1', '🐳')
    expect(useDocsStore.getState().openDoc).toBe(other)
  })

  it('reports a failed write', async () => {
    api.update.mockRejectedValue(new Error('boom'))
    useDocsStore.setState({ docs: [summary()] })
    expect(await useDocsStore.getState().setIcon('doc-1', '🐳')).toBe(false)
    expect(useDocsStore.getState().loadError).toBeTruthy()
  })
})

describe('tree builders carry the icon', () => {
  it('on a Library page', () => {
    expect(buildLibraryTree([summary({ icon: '📘' })])[0].icon).toBe('📘')
  })

  it('on a documented device', () => {
    const device = { id: 'dev-1', label: 'nas', ip: '10.0.0.2', type: 'nas' } as InventoryEntry
    const groups = buildDeviceTree({
      groupBy: 'flat',
      devices: [device],
      docs: [summary({ kind: 'device', device_id: 'dev-1', icon: '💾' })],
      context: { nodes: [], designs: [], activeDesignId: null },
    })
    expect(groups[0].items[0].icon).toBe('💾')
  })
})

describe('DocTreeItem — emoji', () => {
  it('draws the emoji in place of the page icon', () => {
    render(<DocTreeItem {...rowProps} leaf={{ ...page, icon: '🔥' }} />)
    expect(screen.getByText('🔥')).toBeInTheDocument()
  })

  it('draws nothing extra without one', () => {
    render(<DocTreeItem {...rowProps} leaf={page} />)
    expect(screen.queryByText('🔥')).toBeNull()
  })

  it('still names the homepage when it wears an emoji', () => {
    render(<DocTreeItem {...rowProps} leaf={{ ...page, icon: '🏠' }} homeId="doc-1" />)
    expect(screen.getByLabelText('Homepage')).toHaveTextContent('🏠')
  })
})

describe('DocViewer — icon chip', () => {
  it('offers + Icon when the document has none', () => {
    render(<DocViewer {...viewerProps} doc={makeDoc()} onSetIcon={vi.fn()} />)
    expect(screen.getByText('Icon')).toBeInTheDocument()
  })

  it('shows the chosen emoji instead', () => {
    render(<DocViewer {...viewerProps} doc={makeDoc({ icon: '🐳' })} onSetIcon={vi.fn()} />)
    expect(screen.getByLabelText('Tree icon 🐳 — change')).toBeInTheDocument()
    expect(screen.queryByText('Icon')).toBeNull()
  })

  it('picks an emoji from the grid', async () => {
    const onSetIcon = vi.fn()
    render(<DocViewer {...viewerProps} doc={makeDoc()} onSetIcon={onSetIcon} />)
    fireEvent.click(screen.getByText('Icon'))
    fireEvent.click(await screen.findByLabelText('Use 🐳'))
    expect(onSetIcon).toHaveBeenCalledWith('🐳')
  })

  it('takes a pasted emoji from the field', async () => {
    const onSetIcon = vi.fn()
    render(<DocViewer {...viewerProps} doc={makeDoc()} onSetIcon={onSetIcon} />)
    fireEvent.click(screen.getByText('Icon'))
    const input = await screen.findByLabelText('Custom emoji')
    fireEvent.change(input, { target: { value: ' 🦄 ' } })
    fireEvent.submit(input)
    expect(onSetIcon).toHaveBeenCalledWith('🦄')
  })

  it('removes the current emoji', async () => {
    const onSetIcon = vi.fn()
    render(<DocViewer {...viewerProps} doc={makeDoc({ icon: '🐳' })} onSetIcon={onSetIcon} />)
    fireEvent.click(screen.getByLabelText('Tree icon 🐳 — change'))
    fireEvent.click(await screen.findByText('Remove'))
    expect(onSetIcon).toHaveBeenCalledWith(null)
  })

  it('is gone in the read-only view', () => {
    render(<DocViewer {...viewerProps} readOnly doc={makeDoc({ icon: '🐳' })} onSetIcon={vi.fn()} />)
    expect(screen.queryByText('Icon')).toBeNull()
    expect(screen.queryByLabelText('Tree icon 🐳 — change')).toBeNull()
  })
})

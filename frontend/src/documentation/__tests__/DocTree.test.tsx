/**
 * The navigator's rows.
 *
 * A device with no document yet is drawn in italic, and italic glyphs lean past
 * the advance width the label's box shrink-wraps to — so `truncate`'s
 * `overflow: hidden` sliced the tail off every such name. The padding that fixes
 * it is invisible to a test, but the `title` that goes with it is not, and it is
 * what makes a genuinely over-long name readable at all.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DocTreeGroups, DocTreeItem, type TreeDnd } from '../components/DocTree'
import type { TreeGroup, TreeLeaf } from '../types'

function leaf(overrides: Partial<TreeLeaf> = {}): TreeLeaf {
  return {
    id: 'dev-1',
    label: 'bazarr',
    kind: 'device',
    docId: null,
    state: 'none',
    ...overrides,
  }
}

function renderTree(groups: TreeGroup[], expanded: string[] = []) {
  render(
    <DocTreeGroups
      groups={groups}
      activeId={null}
      expanded={expanded}
      starred={new Set()}
      onSelect={vi.fn()}
      onToggle={vi.fn()}
    />,
  )
}

const group = (items: TreeLeaf[], label = 'Network topology'): TreeGroup => ({
  key: 'zone:network-topology',
  label,
  items,
})

describe('DocTree', () => {
  it('renders a device label in full', () => {
    renderTree([group([leaf()])])
    expect(screen.getByText('bazarr')).toBeInTheDocument()
  })

  it('carries the full name as a title, so a clipped one stays readable', () => {
    renderTree([group([leaf({ label: 'suwayomiserver-backend-01' })])])
    expect(screen.getByText('suwayomiserver-backend-01')).toHaveAttribute(
      'title',
      'suwayomiserver-backend-01',
    )
  })

  it('gives the group header the same treatment', () => {
    renderTree([group([leaf()], 'Not on this canvas')])
    expect(screen.getByText('Not on this canvas')).toHaveAttribute('title', 'Not on this canvas')
  })

  it('italicises only a device that has no document yet', () => {
    renderTree([
      group([
        leaf({ id: 'a', label: 'undocumented', docId: null, state: 'none' }),
        leaf({ id: 'b', label: 'documented', docId: 'doc-1', state: 'written' }),
      ]),
    ])
    expect(screen.getByText('undocumented').closest('button')).toHaveClass('italic')
    expect(screen.getByText('documented').closest('button')).not.toHaveClass('italic')
  })

  it('keeps the label clipped rather than letting a long name push the row wide', () => {
    renderTree([group([leaf({ label: 'a-very-long-device-name-that-will-not-fit' })])])
    // The padding is what stops `overflow: hidden` cutting into the last glyph.
    expect(screen.getByText('a-very-long-device-name-that-will-not-fit')).toHaveClass(
      'truncate',
      'pr-0.5',
    )
  })
})

/** A drag needs a dataTransfer; jsdom's synthetic events carry none. */
function transfer() {
  return { effectAllowed: '', dropEffect: '', setData: vi.fn(), getData: () => '' }
}

function dndProps(overrides: Partial<TreeDnd> = {}): TreeDnd {
  return {
    draggingId: null,
    overId: null,
    canDrop: () => true,
    onDragStart: vi.fn(),
    onDragEnd: vi.fn(),
    onDragOver: vi.fn(),
    onDrop: vi.fn(),
    ...overrides,
  }
}

function renderItem(leafValue: TreeLeaf, dnd?: TreeDnd, expanded: string[] = []) {
  return render(
    <DocTreeItem
      leaf={leafValue}
      depth={1}
      activeId={null}
      expanded={expanded}
      starred={new Set()}
      onSelect={vi.fn()}
      onToggle={vi.fn()}
      dnd={dnd}
    />,
  )
}

const page = (overrides: Partial<TreeLeaf> = {}): TreeLeaf =>
  leaf({ id: 'doc-1', docId: 'doc-1', kind: 'page', label: 'Runbook', ...overrides })

const folder = (overrides: Partial<TreeLeaf> = {}): TreeLeaf =>
  leaf({ id: 'folder-1', docId: 'folder-1', kind: 'folder', label: 'Runbooks', children: [], ...overrides })

describe('DocTree drag to file', () => {
  it('makes the icon the handle, not the row', () => {
    const dnd = dndProps()
    renderItem(page(), dnd)
    const handle = screen.getByTestId('drag-doc-1')
    expect(handle).toHaveAttribute('draggable', 'true')
    expect(screen.getByRole('button')).not.toHaveAttribute('draggable')

    fireEvent.dragStart(handle, { dataTransfer: transfer() })
    expect(dnd.onDragStart).toHaveBeenCalledWith(expect.objectContaining({ docId: 'doc-1' }))
  })

  it('leaves rows undraggable when the tree has no filing wired up', () => {
    renderItem(page())
    expect(screen.queryByTestId('drag-doc-1')).not.toBeInTheDocument()
  })

  it('drops a document into a folder', () => {
    const dnd = dndProps()
    renderItem(folder(), dnd)
    const row = screen.getByRole('button')
    fireEvent.dragOver(row, { dataTransfer: transfer() })
    expect(dnd.onDragOver).toHaveBeenCalledWith('folder-1')
    fireEvent.drop(row, { dataTransfer: transfer() })
    expect(dnd.onDrop).toHaveBeenCalledWith('folder-1')
  })

  it('refuses a folder the caller rules out', () => {
    const dnd = dndProps({ canDrop: () => false })
    renderItem(folder(), dnd)
    fireEvent.drop(screen.getByRole('button'), { dataTransfer: transfer() })
    expect(dnd.onDrop).not.toHaveBeenCalled()
  })

  it('never treats a page as a drop target', () => {
    const dnd = dndProps()
    renderItem(page(), dnd)
    fireEvent.drop(screen.getByRole('button'), { dataTransfer: transfer() })
    expect(dnd.onDrop).not.toHaveBeenCalled()
  })
})

describe('DocTree create in a folder (#574)', () => {
  afterEach(() => vi.restoreAllMocks())

  function renderFolder(leafValue: TreeLeaf, onCreateIn = vi.fn(), dnd?: TreeDnd, expanded: string[] = []) {
    const onToggle = vi.fn()
    render(
      <DocTreeItem
        leaf={leafValue}
        depth={1}
        activeId={null}
        expanded={expanded}
        starred={new Set()}
        onSelect={vi.fn()}
        onToggle={onToggle}
        dnd={dnd}
        onCreateIn={onCreateIn}
      />,
    )
    return { onCreateIn, onToggle }
  }

  it('gives a folder a + and a page none', () => {
    renderFolder(folder())
    expect(screen.getByRole('button', { name: 'New in Runbooks' })).toBeInTheDocument()
    cleanup()
    renderFolder(page())
    expect(screen.queryByRole('button', { name: /^New in/ })).not.toBeInTheDocument()
  })

  it('draws no + when the tree has no creation wired up', () => {
    renderItem(folder())
    expect(screen.queryByRole('button', { name: 'New in Runbooks' })).not.toBeInTheDocument()
  })

  it('files a page from a template inside the folder, without toggling it', () => {
    vi.spyOn(window, 'prompt').mockReturnValue('Reboot the NAS')
    const { onCreateIn, onToggle } = renderFolder(folder())

    fireEvent.click(screen.getByRole('button', { name: 'New in Runbooks' }))
    fireEvent.click(screen.getByText('Runbook'))

    expect(onCreateIn).toHaveBeenCalledWith({
      title: 'Reboot the NAS',
      templateId: 'runbook',
      parentId: 'folder-1',
    })
    expect(onToggle).not.toHaveBeenCalled()
  })

  it('files a folder inside the folder', () => {
    vi.spyOn(window, 'prompt').mockReturnValue('  Storage  ')
    const { onCreateIn } = renderFolder(folder())

    fireEvent.click(screen.getByRole('button', { name: 'New in Runbooks' }))
    fireEvent.click(screen.getByText('Folder'))

    expect(onCreateIn).toHaveBeenCalledWith({ title: 'Storage', parentId: 'folder-1', kind: 'folder' })
  })

  it('targets the nested folder its + belongs to', () => {
    vi.spyOn(window, 'prompt').mockReturnValue('Disks')
    const child = folder({ id: 'folder-2', docId: 'folder-2', label: 'Storage' })
    const { onCreateIn } = renderFolder(folder({ children: [child] }), vi.fn(), undefined, ['folder-1'])

    fireEvent.click(screen.getByRole('button', { name: 'New in Storage' }))
    fireEvent.click(screen.getByText('Folder'))

    expect(onCreateIn).toHaveBeenCalledWith({ title: 'Disks', parentId: 'folder-2', kind: 'folder' })
  })

  it('hides the + while something is being dragged', () => {
    renderFolder(folder(), vi.fn(), dndProps({ draggingId: 'doc-9' }))
    expect(screen.queryByRole('button', { name: 'New in Runbooks' })).not.toBeInTheDocument()
  })
})

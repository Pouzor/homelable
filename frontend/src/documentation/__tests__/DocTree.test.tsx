/**
 * The navigator's rows.
 *
 * A device with no document yet is drawn in italic, and italic glyphs lean past
 * the advance width the label's box shrink-wraps to — so `truncate`'s
 * `overflow: hidden` sliced the tail off every such name. The padding that fixes
 * it is invisible to a test, but the `title` that goes with it is not, and it is
 * what makes a genuinely over-long name readable at all.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { DocTreeGroups } from '../components/DocTree'
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

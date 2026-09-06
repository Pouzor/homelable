import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { DocViewer } from '../components/DocViewer'
import { RegenerateDocModal } from '../components/RegenerateDocModal'
import type { Doc } from '../types'

function doc(overrides: Partial<Doc> = {}): Doc {
  return {
    id: 'doc-1',
    kind: 'device',
    title: 'nas-01',
    slug: 'nas-01',
    sort_order: 0,
    tags: [],
    frontmatter: {},
    starred: false,
    device_id: 'dev-1',
    body: '# nas-01\n',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  } as Doc
}

function viewer(overrides: Partial<React.ComponentProps<typeof DocViewer>> = {}) {
  const onRegenerate = vi.fn()
  render(
    <DocViewer
      doc={doc()}
      docs={[]}
      devices={[]}
      drifted={false}
      onEdit={vi.fn()}
      onToggleStar={vi.fn()}
      onMarkReviewed={vi.fn()}
      onRegenerate={onRegenerate}
      onDelete={vi.fn()}
      onOpenDoc={vi.fn()}
      onCreateFromLink={vi.fn()}
      onToggleTask={vi.fn()}
      {...overrides}
    />,
  )
  return { onRegenerate }
}

describe('the regenerate button', () => {
  it('asks the view to confirm rather than regenerating on the spot', async () => {
    const { onRegenerate } = viewer()
    await userEvent.click(screen.getByRole('button', { name: 'Regenerate this document' }))
    expect(onRegenerate).toHaveBeenCalledTimes(1)
  })

  it('is not offered on a folder, which has no generated body', () => {
    viewer({ doc: doc({ kind: 'folder', device_id: null }) })
    expect(screen.queryByRole('button', { name: 'Regenerate this document' })).toBeNull()
  })
})

describe('the regenerate confirmation', () => {
  function setup(overrides: Partial<React.ComponentProps<typeof RegenerateDocModal>> = {}) {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(
      <RegenerateDocModal
        open
        title="nas-01"
        fromDevice
        onCancel={onCancel}
        onConfirm={onConfirm}
        {...overrides}
      />,
    )
    return { onConfirm, onCancel }
  }

  it('spells out that the written body is erased', () => {
    setup()
    expect(screen.getByText(/Everything written in this document is erased/)).toBeTruthy()
    expect(screen.getByText(/Your notes, sections and edits in it are lost/)).toBeTruthy()
    expect(screen.getByText(/saved to the history first/)).toBeTruthy()
  })

  it('names the device facts as the source for a device document', () => {
    setup()
    expect(screen.getByText(/current facts in the database/)).toBeTruthy()
  })

  it('names the template as the source for a library page', () => {
    setup({ fromDevice: false })
    expect(screen.getByText(/from the template this page was created with/)).toBeTruthy()
  })

  it('only regenerates once the destructive button is pressed', async () => {
    const { onConfirm, onCancel } = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: /Erase and regenerate/ }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('locks both buttons while the server is working', () => {
    setup({ busy: true })
    expect(screen.getByRole('button', { name: 'Cancel' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: /Regenerating/ }).hasAttribute('disabled')).toBe(true)
  })
})

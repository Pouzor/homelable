import { useState } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { UpdateFromDeviceModal } from '../components/UpdateFromDeviceModal'
import type { ReconcileChange, ResolutionItem, UpdatePreview } from '../types'

function preview(overrides: Partial<UpdatePreview> = {}): UpdatePreview {
  return {
    preview_id: 'abc123',
    changes: [],
    proposed_body: 'body',
    summary: [],
    unresolved: [],
    ...overrides,
  }
}

function change(overrides: Partial<ReconcileChange> = {}): ReconcileChange {
  return {
    id: 'conflict-1',
    name: 'IP',
    kind: 'field',
    status: 'conflict',
    documented: 'old',
    device: 'new',
    previous: '',
    ...overrides,
  }
}

const PROPS = {
  open: true,
  docTitle: 'nas-01',
  preview: null,
  loading: false,
  resolutions: {},
  onPreview: vi.fn(),
  onResolve: vi.fn(),
  onCancel: vi.fn(),
  onApply: vi.fn(),
  docs: [],
  devices: [],
}

/**
 * A stateful host that behaves like the real store: `onResolve` records the
 * decision, flips the preview into its loading state, and only after the merge
 * answers drops the settled conflict from `unresolved` while keeping every
 * conflict row in `changes`. This is the actual rerender that used to unmount
 * the custom editor after its first debounced keystroke.
 */
function StatefulReview({
  onApply = vi.fn(),
  onResolveLog,
  previewDelay = 20,
}: {
  onApply?: () => void
  onResolveLog: ResolutionItem[]
  previewDelay?: number
}) {
  const [resolutions, setResolutions] = useState<Record<string, ResolutionItem>>({})
  const [current, setCurrent] = useState<UpdatePreview | null>(() =>
    preview({ changes: [change()], unresolved: ['conflict-1'] }),
  )
  const [previewLoading, setPreviewLoading] = useState(false)
  return (
    <UpdateFromDeviceModal
      {...PROPS}
      preview={current}
      loading={previewLoading}
      resolutions={resolutions}
      onResolve={(id, item) => {
        onResolveLog.push(item)
        setResolutions((state) => ({ ...state, [id]: item }))
        setPreviewLoading(true)
        window.setTimeout(() => {
          setCurrent((state) => (state ? { ...state, unresolved: state.unresolved.filter((x) => x !== id) } : state))
          setPreviewLoading(false)
        }, previewDelay)
      }}
      onCancel={() => {
        setResolutions({})
        setCurrent(null)
        setPreviewLoading(false)
      }}
      onApply={onApply}
    />
  )
}

const idle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('UpdateFromDeviceModal', () => {
  it('shows a spinner while the preview is loading', () => {
    render(<UpdateFromDeviceModal {...PROPS} preview={null} loading />)
    expect(screen.getByText('Comparing with the device…')).toBeTruthy()
  })

  it('offers a retry when the preview could not be fetched', () => {
    render(<UpdateFromDeviceModal {...PROPS} preview={null} loading={false} />)
    expect(screen.getByText(/Could not compare this document with the device/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })

  it('declares that nothing to change when summary and unresolved are empty', () => {
    render(<UpdateFromDeviceModal {...PROPS} preview={preview()} />)
    expect(screen.getByText('Nothing to change')).toBeTruthy()
    expect(screen.getByText(/already matches the device/)).toBeTruthy()
  })

  it('hides the Update button when conflicts remain unresolved', () => {
    render(
      <UpdateFromDeviceModal
        {...PROPS}
        preview={preview({ changes: [change()], unresolved: ['conflict-1'] })}
      />,
    )
    expect(screen.queryByRole('button', { name: 'Update the document' })).toBeNull()
    expect(screen.getByRole('button', { name: /Resolve 1 more/ })).toBeTruthy()
  })

  it('shows Update when every conflict is settled', () => {
    render(
      <UpdateFromDeviceModal
        {...PROPS}
        preview={preview({ changes: [change()], unresolved: ['conflict-1'] })}
        resolutions={{ 'conflict-1': { id: 'conflict-1', choice: 'device' } }}
      />,
    )
    expect(screen.getByRole('button', { name: 'Update the document' })).toBeTruthy()
  })

  it('marks only the changed part of each field version and keeps the prior value available', () => {
    render(
      <UpdateFromDeviceModal
        {...PROPS}
        preview={preview({
          changes: [
            change({ documented: 'nas-old.example', device: 'nas-new.example', previous: 'nas-base.example' }),
          ],
          unresolved: ['conflict-1'],
        })}
      />,
    )

    expect(screen.getByText('Your documentation')).toBeTruthy()
    expect(screen.getByText('Latest device information')).toBeTruthy()
    expect(screen.getByText('old')).toHaveProperty('tagName', 'MARK')
    expect(screen.getByText('new')).toHaveProperty('tagName', 'MARK')
    expect(screen.getByText('Show previous shared value')).toBeTruthy()
  })

  it('renders generated hardware tables as tables and highlights their changed rows', () => {
    render(
      <UpdateFromDeviceModal
        {...PROPS}
        preview={preview({
          changes: [
            change({
              kind: 'section',
              documented: '## Hardware\n\n| Component | Model |\n| --- | --- |\n| CPU | Xeon D-1521 |\n| RAM | 32 GB ECC |',
              device: '## Hardware\n\n| Component | Model |\n| --- | --- |\n| CPU | Xeon D-1528 |\n| RAM | 32 GB ECC |',
            }),
          ],
          unresolved: ['conflict-1'],
        })}
      />,
    )

    expect(screen.getAllByRole('table')).toHaveLength(2)
    expect(screen.queryByText('| --- | --- |')).toBeNull()
    expect(screen.getByRole('cell', { name: 'Xeon D-1521' }).closest('tr')).toHaveClass('bg-[var(--status-pending,#e3b341)]/20')
    expect(screen.getByRole('cell', { name: 'Xeon D-1528' }).closest('tr')).toHaveClass('bg-[var(--status-online,#39d353)]/20')
  })

  it('highlights multiline paragraphs and fenced code when a later source line changes', () => {
    render(
      <UpdateFromDeviceModal
        {...PROPS}
        preview={preview({
          changes: [
            change({
              kind: 'section',
              documented: '## Notes\n\nThis is a multiline paragraph where\nthe old firmware is still documented.\n\n```yaml\nfirmware: old\nfeature: enabled\n```',
              device: '## Notes\n\nThis is a multiline paragraph where\nthe new firmware is now installed.\n\n```yaml\nfirmware: new\nfeature: enabled\n```',
            }),
          ],
          unresolved: ['conflict-1'],
        })}
      />,
    )

    expect(screen.getByText(/old firmware is still documented/, { selector: 'p' })).toHaveClass('bg-[var(--status-pending,#e3b341)]/20')
    expect(screen.getByText(/new firmware is now installed/, { selector: 'p' })).toHaveClass('bg-[var(--status-online,#39d353)]/20')
    expect(screen.getByText((_, node) => node?.tagName === 'PRE' && node.textContent?.includes('firmware: old') === true)).toHaveClass('bg-[var(--status-pending,#e3b341)]/20')
    expect(screen.getByText((_, node) => node?.tagName === 'PRE' && node.textContent?.includes('firmware: new') === true)).toHaveClass('bg-[var(--status-online,#39d353)]/20')
  })

  it('requires confirmation when custom replaces keep, even with an empty or unchanged draft', async () => {
    const user = userEvent.setup()
    const onResolve = vi.fn()
    render(
      <UpdateFromDeviceModal
        {...PROPS}
        preview={preview({ changes: [change({ custom: 'old draft' })] })}
        resolutions={{ 'conflict-1': { id: 'conflict-1', choice: 'keep' } }}
        onResolve={onResolve}
      />,
    )

    expect(screen.getByRole('button', { name: 'Update the document' })).toBeTruthy()
    await user.click(screen.getByRole('radio', { name: 'Write my own' }))

    // The visible choice no longer matches the stored keep resolution. Empty
    // custom text (and text equal to the earlier draft) must remain pending.
    expect(screen.getByRole('button', { name: /Resolve 1 more/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Use this text' }).hasAttribute('disabled')).toBe(false)
    await user.clear(screen.getByLabelText('Your text for IP'))
    expect(screen.getByRole('button', { name: /Resolve 1 more/ })).toBeTruthy()
    await user.type(screen.getByLabelText('Your text for IP'), 'old draft')
    expect(screen.getByRole('button', { name: /Resolve 1 more/ })).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Use this text' }))
    expect(onResolve).toHaveBeenCalledWith('conflict-1', {
      id: 'conflict-1',
      choice: 'custom',
      custom: 'old draft',
    })
  })

  it('resets the local choice when its resolution is cleared', () => {
    const current = preview({ changes: [change()], unresolved: ['conflict-1'] })
    const { rerender } = render(
      <UpdateFromDeviceModal
        {...PROPS}
        preview={current}
        resolutions={{ 'conflict-1': { id: 'conflict-1', choice: 'device' } }}
      />,
    )
    expect((screen.getByRole('radio', { name: /Take new/ }) as HTMLInputElement).checked).toBe(true)

    rerender(<UpdateFromDeviceModal {...PROPS} preview={current} resolutions={{}} />)

    expect((screen.getByRole('radio', { name: /Take new/ }) as HTMLInputElement).checked).toBe(false)
    expect(screen.getByRole('button', { name: /Resolve 1 more/ })).toBeTruthy()
  })

  it('locks both buttons while the server is working', () => {
    render(
      <UpdateFromDeviceModal
        {...PROPS}
        preview={preview()}
        loading
      />,
    )
    expect(screen.getByRole('button', { name: 'Cancel' }).hasAttribute('disabled')).toBe(true)
  })

  it('keeps the custom editor mounted and editable across a confirmed resolve and the re-preview', async () => {
    const user = userEvent.setup()
    const log: ResolutionItem[] = []
    render(<StatefulReview onResolveLog={log} />)

    // A live conflict: no resolution yet, so the update button still asks for one.
    expect(screen.getByRole('button', { name: /Resolve 1 more/ })).toBeTruthy()
    await user.click(screen.getByRole('radio', { name: 'Write my own' }))
    const textarea = screen.getByLabelText('Your text for IP')
    expect(textarea).toBeTruthy()

    await user.type(textarea, '10.0.0.5')
    expect((screen.getByLabelText('Your text for IP') as HTMLTextAreaElement).value).toBe('10.0.0.5')

    // An unconfirmed draft keeps the row pending — Update must not run on it yet.
    expect(screen.getByRole('button', { name: /Resolve 1 more/ })).toBeTruthy()

    // Confirm; the store records the text, the re-preview runs, and only when
    // its answer has arrived does Update become available.
    await user.click(screen.getByRole('button', { name: 'Use this text' }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Update the document' })).toBeTruthy()
    }, { timeout: 2000 })
    expect(log.at(-1)).toEqual({ id: 'conflict-1', choice: 'custom', custom: '10.0.0.5' })

    // The row stayed mounted, text intact, and the user can revise it again.
    expect((screen.getByLabelText('Your text for IP') as HTMLTextAreaElement).value).toBe('10.0.0.5')
    await user.type(screen.getByLabelText('Your text for IP'), '6')
    expect((screen.getByLabelText('Your text for IP') as HTMLTextAreaElement).value).toBe('10.0.0.56')
    expect(screen.getByRole('button', { name: /Resolve 1 more/ })).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Use this text' }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Update the document' })).toBeTruthy()
    }, { timeout: 2000 })
    expect(log.at(-1)).toEqual({ id: 'conflict-1', choice: 'custom', custom: '10.0.0.56' })
    expect((screen.getByLabelText('Your text for IP') as HTMLTextAreaElement).value).toBe('10.0.0.56')
  })

  it('abandons unconfirmed custom text when the choice changes and restores it when custom is re-picked', async () => {
    const user = userEvent.setup()
    const log: ResolutionItem[] = []
    render(<StatefulReview onResolveLog={log} />)

    await user.click(screen.getByRole('radio', { name: 'Write my own' }))
    await user.type(screen.getByLabelText('Your text for IP'), 'draft')
    await user.click(screen.getByRole('button', { name: 'Use this text' }))
    await waitFor(() => {
      expect(log.at(-1)).toEqual({ id: 'conflict-1', choice: 'custom', custom: 'draft' })
    }, { timeout: 2000 })

    // The user edits again but walks away without confirming — that text is
    // not a resolution yet, so a different choice must not be overridden by it.
    await user.type(screen.getByLabelText('Your text for IP'), ' v2')
    expect((screen.getByLabelText('Your text for IP') as HTMLTextAreaElement).value).toBe('draft v2')
    await user.click(screen.getByRole('radio', { name: 'Keep my text' }))
    expect(screen.queryByLabelText('Your text for IP')).toBeNull()
    expect(log.at(-1)).toEqual({ id: 'conflict-1', choice: 'keep' })

    // The settled row is still on screen; picking custom again restores the
    // text the user typed and blocks Update until it is confirmed.
    await user.click(screen.getByRole('radio', { name: 'Write my own' }))
    expect((screen.getByLabelText('Your text for IP') as HTMLTextAreaElement).value).toBe('draft v2')
    expect(screen.getByRole('button', { name: /Resolve 1 more/ })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Use this text' }))
    await waitFor(() => {
      expect(log.at(-1)).toEqual({ id: 'conflict-1', choice: 'custom', custom: 'draft v2' })
    }, { timeout: 2000 })
  })

  it('leaves Update locked from the confirm until the matching preview has arrived', async () => {
    const user = userEvent.setup()
    const log: ResolutionItem[] = []
    const onApply = vi.fn()
    render(<StatefulReview onApply={onApply} onResolveLog={log} previewDelay={150} />)

    await user.click(screen.getByRole('radio', { name: 'Write my own' }))
    await user.type(screen.getByLabelText('Your text for IP'), 'abc')
    await user.click(screen.getByRole('button', { name: 'Use this text' }))

    // The resolution is committed, but the preview it needs is still in flight:
    // saving before it lands would write something the user has not seen.
    expect(log.at(-1)).toEqual({ id: 'conflict-1', choice: 'custom', custom: 'abc' })
    expect(screen.queryByRole('button', { name: 'Update the document' })).toBeNull()
    expect(screen.getByRole('button', { name: /Working…/ })).toBeTruthy()
    expect(onApply).not.toHaveBeenCalled()

    // Once the merge answered, Update is offered and applies the shown result.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Update the document' })).toBeTruthy()
    }, { timeout: 2000 })
    await user.click(screen.getByRole('button', { name: 'Update the document' }))
    expect(onApply).toHaveBeenCalled()
    expect(log.at(-1)).toEqual({ id: 'conflict-1', choice: 'custom', custom: 'abc' })
  })

  it('cancel drops the review and any unconfirmed custom draft', async () => {
    const user = userEvent.setup()
    const log: ResolutionItem[] = []
    render(<StatefulReview onResolveLog={log} />)

    expect(screen.getByRole('button', { name: /Resolve 1 more/ })).toBeTruthy()
    await user.click(screen.getByRole('radio', { name: 'Write my own' }))
    await user.type(screen.getByLabelText('Your text for IP'), 'ghost')

    // Unconfirmed text never becomes a resolution; cancel discards the review.
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(log).not.toContainEqual({ id: 'conflict-1', choice: 'custom', custom: 'ghost' })
    expect(screen.queryByLabelText('Your text for IP')).toBeNull()
    await idle(50)
    expect(log).not.toContainEqual({ id: 'conflict-1', choice: 'custom', custom: 'ghost' })
  })
})

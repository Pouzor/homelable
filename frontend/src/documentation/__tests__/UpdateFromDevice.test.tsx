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
 * conflict row in `changes`.
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

describe('UpdateFromDeviceModal', () => {
  it('opens wide enough to read the two versions side by side', () => {
    render(<UpdateFromDeviceModal {...PROPS} preview={null} loading />)
    // The dialog primitive caps every dialog at `sm:max-w-sm`; only an
    // important override lifts it.
    const dialog = screen.getByRole('dialog')
    expect(dialog.className).toContain('!max-w-none')
    expect(dialog.className).toContain('w-[95vw]')
  })

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

  it('offers only the documentation and the device as choices', () => {
    render(
      <UpdateFromDeviceModal
        {...PROPS}
        preview={preview({ changes: [change()], unresolved: ['conflict-1'] })}
      />,
    )
    expect(screen.getAllByRole('radio')).toHaveLength(2)
    expect(screen.getByRole('radio', { name: 'Keep actual documentation' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'Take new device information' })).toBeTruthy()
    expect(screen.queryByRole('radio', { name: 'Write my own' })).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('names the device choice without echoing the raw device value', () => {
    render(
      <UpdateFromDeviceModal
        {...PROPS}
        preview={preview({
          changes: [change({ kind: 'section', device: '| CPU | RAM | Disk |\n|---|---|---|\n| 2 cores | 1 GB | 4 GB |' })],
          unresolved: ['conflict-1'],
        })}
      />,
    )
    expect(screen.getByRole('radio', { name: 'Take new device information' })).toBeTruthy()
  })

  it('offers to remove the entry when the device no longer has it', () => {
    render(
      <UpdateFromDeviceModal
        {...PROPS}
        preview={preview({ changes: [change({ device: '' })], unresolved: ['conflict-1'] })}
      />,
    )
    expect(screen.getByRole('radio', { name: 'Remove it' })).toBeTruthy()
    expect(screen.queryByRole('radio', { name: 'Take new device information' })).toBeNull()
  })

  it('records a choice as soon as it is picked', async () => {
    const user = userEvent.setup()
    const onResolve = vi.fn()
    render(
      <UpdateFromDeviceModal
        {...PROPS}
        preview={preview({ changes: [change()], unresolved: ['conflict-1'] })}
        onResolve={onResolve}
      />,
    )

    await user.click(screen.getByRole('radio', { name: 'Keep actual documentation' }))
    expect(onResolve).toHaveBeenLastCalledWith('conflict-1', { id: 'conflict-1', choice: 'keep' })
    await user.click(screen.getByRole('radio', { name: 'Take new device information' }))
    expect(onResolve).toHaveBeenLastCalledWith('conflict-1', { id: 'conflict-1', choice: 'device' })
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

  it('keeps a settled row on screen so the decision can be revised', async () => {
    const user = userEvent.setup()
    const log: ResolutionItem[] = []
    render(<StatefulReview onResolveLog={log} />)

    expect(screen.getByRole('button', { name: /Resolve 1 more/ })).toBeTruthy()
    await user.click(screen.getByRole('radio', { name: 'Keep actual documentation' }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Update the document' })).toBeTruthy()
    }, { timeout: 2000 })
    expect(log.at(-1)).toEqual({ id: 'conflict-1', choice: 'keep' })

    await user.click(screen.getByRole('radio', { name: 'Take new device information' }))
    await waitFor(() => {
      expect(log.at(-1)).toEqual({ id: 'conflict-1', choice: 'device' })
    }, { timeout: 2000 })
  })

  it('leaves Update locked from the choice until the matching preview has arrived', async () => {
    const user = userEvent.setup()
    const log: ResolutionItem[] = []
    const onApply = vi.fn()
    render(<StatefulReview onApply={onApply} onResolveLog={log} previewDelay={150} />)

    await user.click(screen.getByRole('radio', { name: 'Take new device information' }))

    // The resolution is committed, but the preview it needs is still in flight:
    // saving before it lands would write something the user has not seen.
    expect(log.at(-1)).toEqual({ id: 'conflict-1', choice: 'device' })
    expect(screen.queryByRole('button', { name: 'Update the document' })).toBeNull()
    expect(screen.getByRole('button', { name: /Working…/ })).toBeTruthy()
    expect(onApply).not.toHaveBeenCalled()

    // Once the merge answered, Update is offered and applies the shown result.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Update the document' })).toBeTruthy()
    }, { timeout: 2000 })
    await user.click(screen.getByRole('button', { name: 'Update the document' }))
    expect(onApply).toHaveBeenCalled()
  })
})

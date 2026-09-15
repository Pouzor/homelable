import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { documentsApi } from '@/api/client'
import { DocumentationView } from '../components/DocumentationView'
import { useDocsStore } from '../store'
import type { Doc, DocumentSummary, UpdatePreview } from '../types'

vi.mock('sonner', async () => (await import('@/test/mocks')).mockSonner())

vi.mock('@/api/client', () => ({
  documentsApi: {
    list: vi.fn(),
    coverage: vi.fn(),
    updatePreview: vi.fn(),
    updateFromDevice: vi.fn(),
    revisions: vi.fn(),
    get: vi.fn(),
    backlinks: vi.fn().mockResolvedValue({ data: [] }),
  },
  scanApi: { pending: vi.fn().mockResolvedValue({ data: [] }) },
}))

const api = vi.mocked(documentsApi)
const INITIAL = useDocsStore.getState()

function doc(overrides: Partial<Doc> = {}): Doc {
  return {
    id: 'doc-1',
    kind: 'device',
    title: 'NAS',
    slug: 'nas',
    sort_order: 0,
    device_id: 'device-1',
    tags: [],
    frontmatter: {},
    starred: false,
    drifted: true,
    body: '# NAS\n\nManual backup notes.',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function preview(overrides: Partial<UpdatePreview> = {}): UpdatePreview {
  return {
    preview_id: 'preview-1',
    changes: [],
    proposed_body: '# NAS\n\nManual backup notes.',
    summary: [],
    unresolved: [],
    ...overrides,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

function renderView(openDoc = doc()) {
  const docs = [openDoc as DocumentSummary]
  api.list.mockResolvedValue({ data: docs } as never)
  api.coverage.mockResolvedValue({
    data: { devices: 1, documented: 1, header_only: 0, notes_unmigrated: 0 },
  } as never)
  useDocsStore.setState({
    ...INITIAL,
    docs,
    loaded: true,
    openDoc,
    preview: null,
    previewLoading: false,
    resolutions: {},
  })
  render(<DocumentationView />)
  return screen.getByRole('button', { name: 'Update from device' })
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
})

afterEach(() => cleanup())

describe('DocumentationView — update from device', () => {
  it('previews and applies a safe update with one primary click and a short history-linked summary', async () => {
    const merged = doc({ body: '# NAS\n\nIP: 192.168.1.30\n\nManual backup notes.', drifted: false })
    api.updatePreview.mockResolvedValue({
      data: preview({
        changes: [{
          id: 'section.Network details',
          name: 'Network details',
          kind: 'section',
          status: 'auto',
          documented: 'IP: 192.168.1.20',
          device: '## Network details\n\nIP: 192.168.1.30\n\nA long generated section.',
          previous: 'IP: 192.168.1.20',
        }],
        proposed_body: merged.body,
        summary: ['Network details updated to ## Network details IP: 192.168.1.30 A long generated section.'],
      }),
    } as never)
    api.updateFromDevice.mockResolvedValue({ data: merged } as never)
    api.revisions.mockResolvedValue({ data: [] } as never)
    const { toast } = await import('sonner')

    fireEvent.click(renderView())

    await waitFor(() => expect(api.updateFromDevice).toHaveBeenCalledTimes(1))
    expect(api.updatePreview).toHaveBeenCalledTimes(1)
    expect(api.updateFromDevice).toHaveBeenCalledWith('doc-1', 'preview-1', [])
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText('Manual backup notes.')).toBeInTheDocument()
    expect(toast.success).toHaveBeenCalledWith(
      'Documentation updated: Network details',
      expect.objectContaining({ action: expect.objectContaining({ label: 'View history' }) }),
    )

    const options = vi.mocked(toast.success).mock.calls[0]?.[1]
    const action = options?.action
    if (!action || typeof action === 'function' || !('onClick' in action)) {
      throw new Error('Expected a history action on the update confirmation')
    }
    action.onClick({} as never)
    await waitFor(() => expect(api.revisions).toHaveBeenCalledWith('doc-1'))
  })

  it('only previews conflicts and cancelling writes nothing', async () => {
    api.updatePreview.mockResolvedValue({
      data: preview({
        changes: [{
          id: 'device-info.IP Address',
          name: 'IP address',
          kind: 'field',
          status: 'conflict',
          documented: 'nas.example.lan',
          device: '192.168.1.30',
          previous: '192.168.1.20',
        }],
        unresolved: ['device-info.IP Address'],
      }),
    } as never)

    fireEvent.click(renderView())

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('IP address')).toBeInTheDocument()
    expect(api.updatePreview).toHaveBeenCalledTimes(1)
    expect(api.updateFromDevice).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(api.updateFromDevice).not.toHaveBeenCalled()
  })

  it('retries a failed conflict preview without saving until Update is clicked', async () => {
    const conflict = {
      id: 'device-info.IP Address',
      name: 'IP address',
      kind: 'field' as const,
      status: 'conflict' as const,
      documented: 'nas.example.lan',
      device: '192.168.1.30',
      previous: '192.168.1.20',
    }
    api.updatePreview
      .mockResolvedValueOnce({
        data: preview({ changes: [conflict], unresolved: [conflict.id] }),
      } as never)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({
        data: preview({
          preview_id: 'resolved-preview',
          changes: [conflict],
          unresolved: [],
          summary: ['IP address kept as written'],
        }),
      } as never)
    api.updateFromDevice.mockResolvedValue({ data: doc({ drifted: false }) } as never)

    fireEvent.click(renderView())
    fireEvent.click(await screen.findByRole('radio', { name: 'Keep my text' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }))

    await waitFor(() => expect(api.updatePreview).toHaveBeenCalledTimes(3))
    expect(api.updateFromDevice).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Update the document' }))
    await waitFor(() => expect(api.updateFromDevice).toHaveBeenCalledWith(
      'doc-1',
      'resolved-preview',
      [{ id: conflict.id, choice: 'keep' }],
    ))
  })

  it('retains custom text typed during a failed re-preview and requires confirming it again', async () => {
    const repreview = deferred<{ data: UpdatePreview }>()
    const conflict = {
      id: 'device-info.IP Address',
      name: 'IP address',
      kind: 'field' as const,
      status: 'conflict' as const,
      documented: 'nas.example.lan',
      device: '192.168.1.30',
      previous: '192.168.1.20',
    }
    api.updatePreview
      .mockResolvedValueOnce({
        data: preview({ changes: [conflict], unresolved: [conflict.id] }),
      } as never)
      .mockImplementationOnce(() => repreview.promise)
      .mockResolvedValueOnce({
        data: preview({
          preview_id: 'confirmed-a',
          changes: [conflict],
          unresolved: [],
          summary: ['IP address set from your text'],
        }),
      } as never)
      .mockResolvedValueOnce({
        data: preview({
          preview_id: 'confirmed-b',
          changes: [conflict],
          unresolved: [],
          summary: ['IP address set from your text'],
        }),
      } as never)

    fireEvent.click(renderView())
    fireEvent.click(await screen.findByRole('radio', { name: 'Write my own' }))
    const editor = screen.getByLabelText('Your text for IP address')
    fireEvent.change(editor, { target: { value: 'confirmed A' } })
    fireEvent.click(screen.getByRole('button', { name: 'Use this text' }))
    fireEvent.change(editor, { target: { value: 'unsaved B' } })

    await act(async () => repreview.reject(new Error('offline')))
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(api.updatePreview).toHaveBeenCalledTimes(3))

    expect(screen.getByLabelText('Your text for IP address')).toHaveValue('unsaved B')
    expect(screen.getByRole('button', { name: 'Resolve 1 more' })).toBeDisabled()
    expect(api.updateFromDevice).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Use this text' }))
    await waitFor(() => expect(api.updatePreview).toHaveBeenCalledTimes(4))
    expect(screen.getByRole('button', { name: 'Update the document' })).toBeEnabled()
    expect(api.updateFromDevice).not.toHaveBeenCalled()
  })

  it('keeps a failed comparison visible without writing', async () => {
    api.updatePreview.mockRejectedValueOnce(new Error('offline'))

    fireEvent.click(renderView())

    expect(await screen.findByText('Could not compare this document with the device.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(api.updateFromDevice).not.toHaveBeenCalled()
  })

  it('shows a fresh preview after a stale apply without autoapplying it', async () => {
    const first = preview({
      changes: [{
        id: 'device-info.IP Address',
        name: 'IP address',
        kind: 'field',
        status: 'auto',
        documented: '192.168.1.20',
        device: '192.168.1.30',
        previous: '192.168.1.20',
      }],
      summary: ['IP address updated to 192.168.1.30'],
    })
    const fresh = preview({
      preview_id: 'fresh-preview',
      changes: [{
        id: 'device-info.Hostname',
        name: 'Hostname',
        kind: 'field',
        status: 'auto',
        documented: 'nas-old',
        device: 'nas-new',
        previous: 'nas-old',
      }],
      summary: ['Hostname updated to nas-new'],
    })
    api.updatePreview
      .mockResolvedValueOnce({ data: first } as never)
      .mockResolvedValueOnce({ data: fresh } as never)
    api.updateFromDevice.mockRejectedValueOnce(Object.assign(new Error('stale'), {
      response: { status: 409 },
    }))
    api.get.mockResolvedValueOnce({ data: doc({ updated_at: '2026-01-02T00:00:00Z' }) } as never)

    fireEvent.click(renderView())

    await waitFor(() => expect(api.updatePreview).toHaveBeenCalledTimes(2))
    expect(api.updateFromDevice).toHaveBeenCalledTimes(1)
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Hostname updated to nas-new')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Update the document' })).toBeInTheDocument()
  })

  it('does not autoapply a preview that finishes after navigation', async () => {
    const comparing = deferred<{ data: UpdatePreview }>()
    api.updatePreview.mockImplementationOnce(() => comparing.promise)
    api.get.mockResolvedValueOnce({ data: doc({ id: 'doc-2', title: 'Router', slug: 'router' }) } as never)
    const { toast } = await import('sonner')

    fireEvent.click(renderView())
    await waitFor(() => expect(api.updatePreview).toHaveBeenCalledTimes(1))
    await act(async () => {
      await useDocsStore.getState().open('doc-2')
    })
    expect(screen.getByRole('heading', { name: 'Router' })).toBeInTheDocument()

    await act(async () => {
      comparing.resolve({ data: preview({ summary: ['IP address updated to 192.168.1.30'] }) })
      await comparing.promise
    })

    expect(api.updateFromDevice).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
    expect(useDocsStore.getState().openDoc?.id).toBe('doc-2')
  })

  it('does not close a newer review when an old automatic apply finishes after navigation', async () => {
    const applying = deferred<{ data: Doc }>()
    api.updatePreview.mockResolvedValueOnce({
      data: preview({
        changes: [{
          id: 'device-info.IP Address',
          name: 'IP address',
          kind: 'field',
          status: 'auto',
          documented: '192.168.1.20',
          device: '192.168.1.30',
          previous: '192.168.1.20',
        }],
        summary: ['IP address updated to 192.168.1.30'],
      }),
    } as never)
    api.updateFromDevice.mockImplementationOnce(() => applying.promise)
    api.get.mockResolvedValueOnce({ data: doc({ id: 'doc-2', title: 'Router', slug: 'router' }) } as never)
    const { toast } = await import('sonner')

    fireEvent.click(renderView())
    await waitFor(() => expect(api.updateFromDevice).toHaveBeenCalledTimes(1))
    await act(async () => {
      await useDocsStore.getState().open('doc-2')
    })
    useDocsStore.setState({
      preview: preview({ preview_id: 'doc-2-preview', unresolved: ['new-conflict'] }),
      resolutions: { newer: { id: 'newer', choice: 'keep' } },
    })

    await act(async () => {
      applying.resolve({ data: doc({ body: '# NAS\n\nApplied late.' }) })
      await applying.promise
    })

    expect(useDocsStore.getState().openDoc?.id).toBe('doc-2')
    expect(useDocsStore.getState().preview?.preview_id).toBe('doc-2-preview')
    expect(useDocsStore.getState().resolutions).toEqual({ newer: { id: 'newer', choice: 'keep' } })
    expect(toast.success).not.toHaveBeenCalled()
  })
})

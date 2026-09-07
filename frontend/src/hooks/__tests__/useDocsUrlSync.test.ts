import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useDocsUrlSync } from '@/hooks/useDocsUrlSync'
import type { AppView } from '@/stores/uiStore'

const search = () => window.location.search

interface Props {
  view: AppView
  openDocId: string | null
  ready: boolean
  enabled: boolean
  onRestore: (docId: string | null) => void | Promise<void>
}

const setup = (props: Partial<Props> = {}) => {
  const onRestore = props.onRestore ?? vi.fn()
  return renderHook((p: Props) => useDocsUrlSync(p), {
    initialProps: {
      view: 'canvas' as AppView,
      openDocId: null,
      ready: true,
      enabled: true,
      ...props,
      onRestore,
    },
  })
}

describe('useDocsUrlSync', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/')
  })

  it('writes the section and the document into the URL', async () => {
    const { rerender } = setup()
    await waitFor(() => expect(search()).toBe(''))

    rerender({ view: 'documentation', openDocId: 'doc-1', ready: true, enabled: true, onRestore: vi.fn() })
    await waitFor(() => {
      const params = new URLSearchParams(search())
      expect(params.get('view')).toBe('docs')
      expect(params.get('doc')).toBe('doc-1')
    })
  })

  it('drops both params when leaving the section', async () => {
    const { rerender } = setup({ view: 'documentation', openDocId: 'doc-1' })
    await waitFor(() => expect(new URLSearchParams(search()).get('doc')).toBe('doc-1'))

    rerender({ view: 'canvas', openDocId: null, ready: true, enabled: true, onRestore: vi.fn() })
    await waitFor(() => {
      const params = new URLSearchParams(search())
      expect(params.get('view')).toBeNull()
      expect(params.get('doc')).toBeNull()
    })
  })

  it('preserves the design param', async () => {
    window.history.replaceState(null, '', '/?design=abc')
    setup({ view: 'documentation', openDocId: 'doc-1' })
    await waitFor(() => expect(new URLSearchParams(search()).get('design')).toBe('abc'))
  })

  // The regression: the writer used to run before the reader and overwrite
  // `?view=docs&doc=` with the default view, so a refresh lost the document.
  it('restores the document the URL asks for instead of wiping it', async () => {
    window.history.replaceState(null, '', '/?design=abc&view=docs&doc=doc-9')
    const onRestore = vi.fn()
    setup({ onRestore })

    await waitFor(() => expect(onRestore).toHaveBeenCalledWith('doc-9'))
    const params = new URLSearchParams(search())
    expect(params.get('view')).toBe('docs')
    expect(params.get('doc')).toBe('doc-9')
  })

  it('restores the section when the URL names no document', async () => {
    window.history.replaceState(null, '', '/?view=docs')
    const onRestore = vi.fn()
    setup({ onRestore })

    await waitFor(() => expect(onRestore).toHaveBeenCalledWith(null))
  })

  it('keeps the URL across the auth bootstrap and restores once ready', async () => {
    window.history.replaceState(null, '', '/?view=docs&doc=doc-9')
    const onRestore = vi.fn()
    const { rerender } = setup({ ready: false, onRestore })

    // Still signed out: nothing fetched, and the request survives in the URL.
    await waitFor(() => expect(new URLSearchParams(search()).get('doc')).toBe('doc-9'))
    expect(onRestore).not.toHaveBeenCalled()

    rerender({ view: 'canvas', openDocId: null, ready: true, enabled: true, onRestore })
    await waitFor(() => expect(onRestore).toHaveBeenCalledWith('doc-9'))
  })

  it('holds the URL until an awaited restore settles', async () => {
    window.history.replaceState(null, '', '/?view=docs&doc=doc-9')
    let release: () => void = () => {}
    const onRestore = vi.fn(() => new Promise<void>((resolve) => (release = resolve)))
    const { rerender } = setup({ onRestore })

    await waitFor(() => expect(onRestore).toHaveBeenCalled())
    // The section has switched but the document has not landed yet: the writer
    // must not publish `view=docs` with no `doc` in the meantime.
    rerender({ view: 'documentation', openDocId: null, ready: true, enabled: true, onRestore })
    expect(new URLSearchParams(search()).get('doc')).toBe('doc-9')

    release()
    rerender({ view: 'documentation', openDocId: 'doc-9', ready: true, enabled: true, onRestore })
    await waitFor(() => expect(new URLSearchParams(search()).get('doc')).toBe('doc-9'))
  })

  it('releases the URL when the restore fails, so the section can be left', async () => {
    window.history.replaceState(null, '', '/?view=docs&doc=gone')
    const onRestore = vi.fn(() => Promise.reject(new Error('no such document')))
    const { rerender } = setup({ onRestore })

    await waitFor(() => expect(onRestore).toHaveBeenCalled())
    rerender({ view: 'canvas', openDocId: null, ready: true, enabled: true, onRestore })
    await waitFor(() => expect(new URLSearchParams(search()).get('doc')).toBeNull())
  })

  it('ignores the URL in standalone, where documents need a backend', async () => {
    window.history.replaceState(null, '', '/?view=docs&doc=doc-9')
    const onRestore = vi.fn()
    setup({ enabled: false, onRestore })

    await waitFor(() => expect(search()).toBe(''))
    expect(onRestore).not.toHaveBeenCalled()
  })

  it('restores only once', async () => {
    window.history.replaceState(null, '', '/?view=docs&doc=doc-9')
    const onRestore = vi.fn()
    const { rerender } = setup({ onRestore })

    await waitFor(() => expect(onRestore).toHaveBeenCalledTimes(1))
    rerender({ view: 'documentation', openDocId: 'doc-9', ready: true, enabled: true, onRestore })
    rerender({ view: 'documentation', openDocId: 'doc-2', ready: true, enabled: true, onRestore })
    await waitFor(() => expect(new URLSearchParams(search()).get('doc')).toBe('doc-2'))
    expect(onRestore).toHaveBeenCalledTimes(1)
  })

  it('does not add history entries', async () => {
    const before = window.history.length
    const { rerender } = setup()
    rerender({ view: 'documentation', openDocId: 'doc-1', ready: true, enabled: true, onRestore: vi.fn() })
    await waitFor(() => expect(new URLSearchParams(search()).get('doc')).toBe('doc-1'))
    expect(window.history.length).toBe(before)
  })
})

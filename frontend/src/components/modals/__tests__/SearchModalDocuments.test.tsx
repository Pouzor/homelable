/**
 * Documents in the global search.
 *
 * Nodes and pending devices filter a list already in memory; documents cannot —
 * the tree holds their metadata and never their bodies — so this half goes to
 * the server's index, debounced, and has to behave when it is slow, when it
 * fails, and when the query has moved on.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { SearchModal } from '../SearchModal'
import { documentsApi } from '@/api/client'
import { useCanvasStore } from '@/stores/canvasStore'

vi.mock('@xyflow/react', () => ({
  useReactFlow: () => ({ fitView: vi.fn() }),
}))

vi.mock('@/api/client', () => ({
  scanApi: { pending: vi.fn().mockResolvedValue({ data: [] }) },
  documentsApi: { search: vi.fn() },
}))

const api = vi.mocked(documentsApi)

function hit(overrides: Partial<{ doc_id: string; title: string; kind: string; snippet: string }> = {}) {
  return {
    doc_id: 'doc-1',
    title: 'VLAN plan',
    kind: 'page',
    snippet: 'the VLAN plan for the lab',
    device_id: null,
    ...overrides,
  }
}

function open(onOpenDocument = vi.fn()) {
  render(<SearchModal open onClose={vi.fn()} onOpenInventory={vi.fn()} onOpenDocument={onOpenDocument} />)
  return { onOpenDocument, input: screen.getByPlaceholderText(/search nodes/i) }
}

/** Type, then let the debounce fire and the promise settle. */
async function search(input: HTMLElement, text: string) {
  fireEvent.change(input, { target: { value: text } })
  await act(async () => {
    vi.advanceTimersByTime(300)
  })
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.clearAllMocks()
  useCanvasStore.setState({ nodes: [], edges: [], selectedNodeId: null })
  api.search.mockResolvedValue({ data: { engine: 'fts5', hits: [hit()] } } as never)
})

afterEach(() => vi.useRealTimers())

describe('SearchModal — documents', () => {
  it('lists a matching document with its snippet', async () => {
    const { input } = open()

    await search(input, 'vlan')

    expect(api.search).toHaveBeenCalledWith('vlan', 5)
    await waitFor(() => expect(screen.getByText('VLAN plan')).toBeTruthy())
    expect(screen.getByText('the VLAN plan for the lab')).toBeTruthy()
  })

  it('opens the document that was picked', async () => {
    const { input, onOpenDocument } = open()

    await search(input, 'vlan')
    await waitFor(() => screen.getByText('VLAN plan'))
    fireEvent.click(screen.getByText('VLAN plan'))

    expect(onOpenDocument).toHaveBeenCalledWith('doc-1')
  })

  it('marks a device document apart from a page', async () => {
    api.search.mockResolvedValue({
      data: { engine: 'fts5', hits: [hit({ kind: 'device', title: 'nas-01' })] },
    } as never)
    const { input } = open()

    await search(input, 'nas')

    await waitFor(() => expect(screen.getByText('doc·dev')).toBeTruthy())
  })

  it('does not ask the server for a one-character query', async () => {
    const { input } = open()

    await search(input, 'v')

    expect(api.search).not.toHaveBeenCalled()
  })

  it('asks once for a query typed in one go, not once per keystroke', async () => {
    const { input } = open()

    fireEvent.change(input, { target: { value: 'vl' } })
    fireEvent.change(input, { target: { value: 'vla' } })
    await search(input, 'vlan')

    expect(api.search).toHaveBeenCalledTimes(1)
    expect(api.search).toHaveBeenCalledWith('vlan', 5)
  })

  it('drops an answer once the query has moved on', async () => {
    const { input } = open()
    await search(input, 'vlan')
    await waitFor(() => screen.getByText('VLAN plan'))

    // Answers are kept with the query they answered, so this one stops applying.
    fireEvent.change(input, { target: { value: 'vlan switch' } })

    expect(screen.queryByText('VLAN plan')).toBeNull()
  })

  it('keeps working when the index is unavailable', async () => {
    api.search.mockRejectedValue(new Error('no fts'))
    useCanvasStore.setState({
      nodes: [
        {
          id: 'n1',
          type: 'server',
          position: { x: 0, y: 0 },
          data: { label: 'vlan-router', type: 'server', status: 'unknown', services: [] },
        },
      ],
    } as never)
    const { input } = open()

    await search(input, 'vlan')

    expect(screen.getByText('vlan-router')).toBeTruthy()
    expect(screen.queryByText('VLAN plan')).toBeNull()
  })

  it('asks for nothing at all when the host offers no way to open a document', async () => {
    render(<SearchModal open onClose={vi.fn()} onOpenInventory={vi.fn()} />)

    await search(screen.getByPlaceholderText(/search nodes/i), 'vlan')

    expect(api.search).not.toHaveBeenCalled()
    expect(screen.getByText(/no results match/i)).toBeTruthy()
  })

  it('opens the first document on Enter when nothing else matched', async () => {
    const { input, onOpenDocument } = open()

    await search(input, 'vlan')
    await waitFor(() => screen.getByText('VLAN plan'))
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onOpenDocument).toHaveBeenCalledWith('doc-1')
  })
})

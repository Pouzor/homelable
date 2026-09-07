/**
 * The Documentation tour steps ring elements of this view by selector. Nothing
 * else reads those attributes, so only a test keeps a rename from quietly
 * leaving two steps spotlighting an empty screen.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'

import { STEPS } from '@/walkthrough/steps'
import { DocumentationView } from '../components/DocumentationView'
import { useDocsStore } from '../store'

vi.mock('sonner', async () => (await import('@/test/mocks')).mockSonner())

vi.mock('@/api/client', () => ({
  documentsApi: {
    list: vi.fn().mockResolvedValue({ data: [] }),
    coverage: vi.fn().mockResolvedValue({
      data: { devices: 0, documented: 0, header_only: 0, notes_unmigrated: 0 },
    }),
  },
  scanApi: { pending: vi.fn().mockResolvedValue({ data: [] }) },
}))

beforeEach(() => {
  useDocsStore.setState({ docs: [], loaded: false, openDoc: null, filter: '' })
})
afterEach(() => cleanup())

describe('Documentation tour anchors', () => {
  it('carries the anchors the docs-write and docs-devices steps spotlight', async () => {
    render(<DocumentationView />)
    await waitFor(() => expect(screen.getByLabelText('New document')).toBeInTheDocument())

    for (const id of ['docs-write', 'docs-devices']) {
      const step = STEPS.find((s) => s.id === id)
      expect(step?.anchor).toBeDefined()
      expect(document.querySelector(step!.anchor!)).toBeInTheDocument()
    }
  })
})

/**
 * #581: the Devices tree grouped by Subnet always guessed a /24 — the view
 * handed the tree an empty range list — so a 192.168.0.0/23 LAN showed up as
 * two subnets. The configured scan ranges now name the groups.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

import { documentsApi, scanApi } from '@/api/client'
import { DocumentationView } from '../components/DocumentationView'
import { useDocsStore } from '../store'

vi.mock('sonner', async () => (await import('@/test/mocks')).mockSonner())

vi.mock('@/api/client', () => ({
  documentsApi: {
    list: vi.fn().mockResolvedValue({ data: [] }),
    coverage: vi.fn().mockResolvedValue({
      data: { devices: 2, documented: 0, header_only: 0, notes_unmigrated: 0 },
    }),
    revisions: vi.fn().mockResolvedValue({ data: [] }),
    backlinks: vi.fn().mockResolvedValue({ data: [] }),
  },
  scanApi: { pending: vi.fn(), getConfig: vi.fn() },
  docsviewApi: { getConfig: vi.fn().mockResolvedValue({ data: { enabled: false, key: null } }) },
}))

const INITIAL = useDocsStore.getState()

function device(id: string, ip: string) {
  return { id, ip, hostname: id, status: 'pending', services: [] }
}

function renderView(ranges: string[] | Error) {
  vi.mocked(documentsApi.list).mockResolvedValue({ data: [] } as never)
  vi.mocked(scanApi.pending).mockResolvedValue({
    data: [device('nas', '192.168.0.10'), device('cam', '192.168.1.20')],
  } as never)
  if (ranges instanceof Error) vi.mocked(scanApi.getConfig).mockRejectedValue(ranges)
  else vi.mocked(scanApi.getConfig).mockResolvedValue({ data: { ranges } } as never)
  useDocsStore.setState({ ...INITIAL, docs: [], loaded: true, openDoc: null, groupBy: 'subnet' })
  render(<DocumentationView />)
}

afterEach(() => {
  cleanup()
  useDocsStore.setState(INITIAL)
})

describe('DocumentationView — Subnet grouping (#581)', () => {
  it('puts a /23 LAN under the configured range, not two /24s', async () => {
    renderView(['192.168.0.0/23'])

    expect(await screen.findByText('192.168.0.0/23')).toBeInTheDocument()
    expect(screen.queryByText('192.168.0.0/24')).not.toBeInTheDocument()
    expect(screen.queryByText('192.168.1.0/24')).not.toBeInTheDocument()
  })

  it('falls back to one /24 per address when the scan config cannot be read', async () => {
    renderView(new Error('offline'))

    expect(await screen.findByText('192.168.0.0/24')).toBeInTheDocument()
    expect(screen.getByText('192.168.1.0/24')).toBeInTheDocument()
  })
})

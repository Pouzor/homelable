import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { Sidebar } from '../Sidebar'
import { useCanvasStore } from '@/stores/canvasStore'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/stores/canvasStore')

vi.mock('@/api/client', () => ({
  scanApi: {
    trigger: vi.fn().mockResolvedValue({}),
    pending: vi.fn().mockResolvedValue({ data: [] }),
    hidden: vi.fn().mockResolvedValue({ data: [] }),
    runs: vi.fn().mockResolvedValue({ data: [] }),
    stop: vi.fn().mockResolvedValue({}),
    getConfig: vi.fn().mockResolvedValue({ data: { ranges: [] } }),
  },
  settingsApi: {
    get: vi.fn().mockResolvedValue({ data: { interval_seconds: 60 } }),
    save: vi.fn().mockResolvedValue({}),
  },
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/components/ui/Logo', () => ({ Logo: () => null }))
vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: () => null,
}))
vi.mock('@/components/modals/PendingDeviceModal', () => ({ PendingDeviceModal: () => null }))
vi.mock('@/components/modals/StatusTimelineModal', () => ({ StatusTimelineModal: () => null }))

vi.mock('@/hooks/useLatestRelease', () => ({
  useLatestRelease: vi.fn(),
}))

import { useLatestRelease } from '@/hooks/useLatestRelease'

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderSidebar() {
  vi.mocked(useCanvasStore).mockReturnValue({
    nodes: [],
    hasUnsavedChanges: false,
    hideIp: false,
    toggleHideIp: vi.fn(),
    addNode: vi.fn(),
    scanEventTs: 0,
  } as unknown as ReturnType<typeof useCanvasStore>)

  return render(
    <Sidebar
      onAddNode={vi.fn()}
      onAddGroupRect={vi.fn()}
      onScan={vi.fn()}
      onSave={vi.fn()}
      onNodeApproved={vi.fn()}
    />,
  )
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('VersionBadge', () => {
  beforeEach(() => {
    vi.mocked(useLatestRelease).mockReturnValue({ latest: null, hasUpdate: false })
  })

  it('displays the current app version', () => {
    renderSidebar()
    expect(screen.getByText(`v${__APP_VERSION__}`)).toBeInTheDocument()
  })

  it('links current version to its GitHub release page', () => {
    renderSidebar()
    const link = screen.getByText(`v${__APP_VERSION__}`).closest('a')
    expect(link).toHaveAttribute(
      'href',
      `https://github.com/Pouzor/homelable/releases/tag/v${__APP_VERSION__}`,
    )
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('does not show update badge when on latest version', () => {
    renderSidebar()
    expect(screen.queryByText(/available/)).not.toBeInTheDocument()
  })

  it('shows update badge when a newer version is available', async () => {
    vi.mocked(useLatestRelease).mockReturnValue({
      latest: { version: '9.9.9', url: 'https://github.com/Pouzor/homelable/releases/tag/v9.9.9' },
      hasUpdate: true,
    })
    renderSidebar()
    await waitFor(() => expect(screen.getByText('↑ v9.9.9 available')).toBeInTheDocument())
  })

  it('update badge links to the latest release URL', async () => {
    vi.mocked(useLatestRelease).mockReturnValue({
      latest: { version: '9.9.9', url: 'https://github.com/Pouzor/homelable/releases/tag/v9.9.9' },
      hasUpdate: true,
    })
    renderSidebar()
    await waitFor(() => {
      const badge = screen.getByText('↑ v9.9.9 available').closest('a')
      expect(badge).toHaveAttribute('href', 'https://github.com/Pouzor/homelable/releases/tag/v9.9.9')
      expect(badge).toHaveAttribute('target', '_blank')
    })
  })

  it('does not show update badge when hasUpdate is false even if latest exists', () => {
    vi.mocked(useLatestRelease).mockReturnValue({
      latest: { version: __APP_VERSION__, url: 'https://github.com' },
      hasUpdate: false,
    })
    renderSidebar()
    expect(screen.queryByText(/available/)).not.toBeInTheDocument()
  })
})

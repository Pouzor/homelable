import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// Mocks must be declared before importing the component to ensure they are used
const mockExportToPng = vi.fn()
vi.mock('@/utils/export', () => ({
  exportToPng: (...args: unknown[]) => mockExportToPng(...args),
  EXPORT_QUALITY_OPTIONS: [
    { value: 'standard', label: 'Standard', pixelRatio: 1, hint: '1× — small file' },
    { value: 'high',     label: 'High',     pixelRatio: 2, hint: '2× — recommended' },
    { value: 'ultra',    label: 'Ultra',    pixelRatio: 4, hint: '4× — print quality, large file' },
  ],
}))

const mockExportCanvasToBase64 = vi.fn(() => 'BASE64_PAYLOAD')
vi.mock('@/utils/exportCanvas', () => ({
  exportCanvasToBase64: (...args: unknown[]) => mockExportCanvasToBase64(...args),
  importCanvasFromBase64: vi.fn(),
}))

vi.mock('@/stores/canvasStore', () => ({
  // `useCanvasStore` should accept a selector function and return the selected slice.
  useCanvasStore: (selector: (s: { nodes: unknown[]; edges: unknown[] }) => unknown) =>
    // Provide a minimal store shape for tests
    selector({ nodes: [], edges: [] }),
}))

const mockToast = { toast: { success: vi.fn(), error: vi.fn() } }
vi.mock('sonner', () => mockToast)

import { ExportModal } from '../ExportModal'

const el = document.createElement('div')
const getElement = () => el
const onClose = vi.fn()

describe('ExportModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExportToPng.mockResolvedValue(undefined)
    // mock clipboard
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(navigator as any).clipboard = { writeText: vi.fn() }
  })

  it('renders all three quality options', () => {
    render(<ExportModal open onClose={onClose} getElement={getElement} />)
    expect(screen.getByText('Standard')).toBeInTheDocument()
    expect(screen.getByText('High')).toBeInTheDocument()
    expect(screen.getByText('Ultra')).toBeInTheDocument()
  })

  it('selects High by default', () => {
    render(<ExportModal open onClose={onClose} getElement={getElement} />)
    const highBtn = screen.getByText('High').closest('button')!
    expect(highBtn.className).toContain('border-[#00d4ff]')
  })

  it('changes selection when another option is clicked', () => {
    render(<ExportModal open onClose={onClose} getElement={getElement} />)
    fireEvent.click(screen.getByText('Ultra').closest('button')!)
    expect(screen.getByText('Ultra').closest('button')!.className).toContain('border-[#00d4ff]')
    expect(screen.getByText('High').closest('button')!.className).not.toContain('border-[#00d4ff]')
  })

  it('calls exportToPng with selected quality on Download click', async () => {
    render(<ExportModal open onClose={onClose} getElement={getElement} />)
    fireEvent.click(screen.getByText('Standard').closest('button')!)
    fireEvent.click(screen.getByRole('button', { name: /download/i }))
    await waitFor(() => expect(mockExportToPng).toHaveBeenCalledWith(el, 'standard'))
  })

  it('closes after successful export', async () => {
    render(<ExportModal open onClose={onClose} getElement={getElement} />)
    fireEvent.click(screen.getByRole('button', { name: /download/i }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('calls onClose when Cancel is clicked', () => {
    render(<ExportModal open onClose={onClose} getElement={getElement} />)
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onClose).toHaveBeenCalled()
  })

  it('does not call exportToPng when getElement returns null', async () => {
    render(<ExportModal open onClose={onClose} getElement={() => null} />)
    fireEvent.click(screen.getByRole('button', { name: /download/i }))
    await waitFor(() => expect(mockExportToPng).not.toHaveBeenCalled())
  })

  it('does not render when closed', () => {
    render(<ExportModal open={false} onClose={onClose} getElement={getElement} />)
    expect(screen.queryByText('Export as PNG')).not.toBeInTheDocument()
  })

  it('exports to base64, copies to clipboard and shows toast on Base64 button click', async () => {
    render(<ExportModal open onClose={onClose} getElement={getElement} />)
    const btn = screen.getByRole('button', { name: /copy as base64/i })
    fireEvent.click(btn)
    await waitFor(() => expect((navigator as any).clipboard.writeText).toHaveBeenCalledWith('BASE64_PAYLOAD'))
    expect(mockToast.toast.success).toHaveBeenCalled()
  })
})

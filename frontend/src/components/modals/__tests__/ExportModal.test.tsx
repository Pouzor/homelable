import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ExportModal } from '../ExportModal'

const mockExportToPng = vi.fn()
vi.mock('@/utils/export', () => ({
  exportToPng: (...args: unknown[]) => mockExportToPng(...args),
  EXPORT_QUALITY_OPTIONS: [
    { value: 'standard', label: 'Standard', pixelRatio: 1, hint: '1× — small file' },
    { value: 'high',     label: 'High',     pixelRatio: 2, hint: '2× — recommended' },
    { value: 'ultra',    label: 'Ultra',    pixelRatio: 4, hint: '4× — print quality, large file' },
  ],
}))

const el = document.createElement('div')
const getElement = () => el
const onClose = vi.fn()

describe('ExportModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExportToPng.mockResolvedValue(undefined)
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
})

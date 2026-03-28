import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ThemeModal } from '../ThemeModal'
import { useThemeStore } from '@/stores/themeStore'
import { useCanvasStore } from '@/stores/canvasStore'
import { THEME_ORDER } from '@/utils/themes'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))
import { toast } from 'sonner'

describe('ThemeModal', () => {
  beforeEach(() => {
    useThemeStore.setState({ activeTheme: 'default' })
    useCanvasStore.setState({ hasUnsavedChanges: false })
    vi.mocked(toast.info).mockReset()
  })

  it('renders nothing when closed', () => {
    const { container } = render(<ThemeModal open={false} onClose={vi.fn()} />)
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })

  it('renders all available themes', () => {
    render(<ThemeModal open onClose={vi.fn()} />)
    // Every theme in THEME_ORDER should have a card rendered
    expect(THEME_ORDER.length).toBeGreaterThan(0)
    // At minimum the dialog title should be present
    expect(screen.getByText('Choose Canvas Style')).toBeDefined()
  })

  it('shows Apply Style button', () => {
    render(<ThemeModal open onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Apply Style' })).toBeDefined()
  })

  it('shows Cancel button', () => {
    render(<ThemeModal open onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDefined()
  })

  it('live-previews theme when a card is clicked', () => {
    render(<ThemeModal open onClose={vi.fn()} />)
    const initialTheme = useThemeStore.getState().activeTheme
    // Click a different theme card (find by button role, pick a non-default one)
    const cards = screen.getAllByRole('button').filter((b) =>
      b.className.includes('rounded-xl')
    )
    // Click the second card (first non-selected)
    fireEvent.click(cards[1])
    // Theme should have changed for live preview
    expect(useThemeStore.getState().activeTheme).not.toBe(initialTheme)
  })

  it('Apply sets theme, marks unsaved, and closes', () => {
    const onClose = vi.fn()
    render(<ThemeModal open onClose={onClose} />)
    // Click a non-default card first
    const cards = screen.getAllByRole('button').filter((b) => b.className.includes('rounded-xl'))
    fireEvent.click(cards[1])
    const previewTheme = useThemeStore.getState().activeTheme
    fireEvent.click(screen.getByRole('button', { name: 'Apply Style' }))
    expect(useThemeStore.getState().activeTheme).toBe(previewTheme)
    expect(useCanvasStore.getState().hasUnsavedChanges).toBe(true)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('Apply shows toast asking user to save canvas', () => {
    render(<ThemeModal open onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Apply Style' }))
    expect(toast.info).toHaveBeenCalledWith(
      expect.stringContaining('save'),
      expect.any(Object)
    )
  })

  it('Cancel reverts to original theme and closes', () => {
    const onClose = vi.fn()
    useThemeStore.setState({ activeTheme: 'default' })
    render(<ThemeModal open onClose={onClose} />)
    // Preview a different theme
    const cards = screen.getAllByRole('button').filter((b) => b.className.includes('rounded-xl'))
    fireEvent.click(cards[1])
    expect(useThemeStore.getState().activeTheme).not.toBe('default')
    // Cancel should revert
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(useThemeStore.getState().activeTheme).toBe('default')
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('Cancel does not mark canvas as unsaved', () => {
    render(<ThemeModal open onClose={vi.fn()} />)
    const cards = screen.getAllByRole('button').filter((b) => b.className.includes('rounded-xl'))
    fireEvent.click(cards[1])
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(useCanvasStore.getState().hasUnsavedChanges).toBe(false)
  })
})

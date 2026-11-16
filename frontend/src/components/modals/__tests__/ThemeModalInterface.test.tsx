import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { ThemeModal } from '../ThemeModal'
import { useThemeStore, INTERFACE_THEME_STORAGE_KEY } from '@/stores/themeStore'
import { useCanvasStore } from '@/stores/canvasStore'

vi.mock('sonner', async () => (await import('@/test/mocks')).mockSonner())

describe('ThemeModal — interface selector', () => {
  beforeEach(() => {
    localStorage.clear()
    useThemeStore.setState({ activeTheme: 'default', interfaceTheme: 'dark' })
    useCanvasStore.setState({ hasUnsavedChanges: false })
  })

  it('offers Classic, Dark, Light and Auto, with the current one checked', () => {
    render(<ThemeModal open onClose={vi.fn()} />)
    const group = screen.getByRole('radiogroup', { name: 'Interface theme' })
    const radios = within(group).getAllByRole('radio')
    expect(radios.map((r) => r.textContent)).toEqual(['Classic', 'Dark', 'Light', 'Auto'])
    expect(within(group).getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true')
  })

  it('applies a choice at once, remembers it, and does not dirty the canvas', () => {
    render(<ThemeModal open onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('radio', { name: 'Light' }))

    expect(useThemeStore.getState().interfaceTheme).toBe('light')
    expect(localStorage.getItem(INTERFACE_THEME_STORAGE_KEY)).toBe('light')
    expect(screen.getByRole('radio', { name: 'Light' })).toHaveAttribute('aria-checked', 'true')
    expect(useCanvasStore.getState().hasUnsavedChanges).toBe(false)
  })

  it('maps Auto to the system interface', () => {
    render(<ThemeModal open onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('radio', { name: 'Auto' }))
    expect(useThemeStore.getState().interfaceTheme).toBe('system')
  })

  it('keeps the interface choice when the canvas style is cancelled', () => {
    const onClose = vi.fn()
    render(<ThemeModal open onClose={onClose} />)
    fireEvent.click(screen.getByRole('radio', { name: 'Classic' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onClose).toHaveBeenCalled()
    expect(useThemeStore.getState().interfaceTheme).toBe('classic')
  })
})

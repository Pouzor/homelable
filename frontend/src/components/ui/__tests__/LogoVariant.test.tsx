import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Logo } from '../Logo'
import { useThemeStore } from '@/stores/themeStore'

const disc = () => screen.getByTestId('logo-mark').querySelectorAll('circle')[0]
const house = () => screen.getByTestId('logo-mark').querySelector('path')!
const hub = () => screen.getByTestId('logo-mark').querySelectorAll('circle')[3]

describe('Logo — interface variants', () => {
  beforeEach(() => {
    useThemeStore.setState({ interfaceTheme: 'dark', systemDark: true })
  })

  it('draws the official dark mark on the dark interfaces', () => {
    for (const mode of ['classic', 'dark'] as const) {
      useThemeStore.setState({ interfaceTheme: mode })
      const { unmount } = render(<Logo showText={false} />)
      expect(screen.getByTestId('logo-mark')).toHaveAttribute('data-variant', 'dark')
      expect(disc()).toHaveAttribute('fill', '#0d1117')
      expect(house()).toHaveAttribute('fill', '#161b22')
      expect(hub().getAttribute('filter')).toMatch(/^url\(#homelable-node-glow-/)
      unmount()
    }
  })

  it('switches to a light mark, without glow, on the Light interface', () => {
    useThemeStore.setState({ interfaceTheme: 'light' })
    render(<Logo showText={false} />)
    expect(screen.getByTestId('logo-mark')).toHaveAttribute('data-variant', 'light')
    expect(disc()).toHaveAttribute('fill', '#e8f6fd')
    expect(house()).toHaveAttribute('fill', '#ffffff')
    expect(house()).toHaveAttribute('stroke', '#0288d1')
    expect(hub()).not.toHaveAttribute('filter')
  })

  it('follows the OS scheme on Auto', () => {
    useThemeStore.setState({ interfaceTheme: 'system', systemDark: false })
    render(<Logo showText={false} />)
    expect(screen.getByTestId('logo-mark')).toHaveAttribute('data-variant', 'light')
  })

  it('keeps the same shape in both variants', () => {
    useThemeStore.setState({ interfaceTheme: 'light' })
    render(<Logo showText={false} />)
    expect(house().getAttribute('d')).toBe('M32 11 L53 30 L48 30 L48 53 L16 53 L16 30 L11 30 Z')
    expect(screen.getByTestId('logo-mark').querySelectorAll('circle').length).toBe(7)
  })
})

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Logo } from '../Logo'

describe('Logo', () => {
  it('renders the official mark (house + network nodes), not a placeholder icon', () => {
    render(<Logo />)
    const svg = screen.getByTestId('logo-mark')
    // Canonical house outline from docs/logo/icon.svg
    expect(svg.querySelector('path')?.getAttribute('d'))
      .toBe('M32 11 L53 30 L48 30 L48 53 L16 53 L16 30 L11 30 Z')
    // Center hub + 3 peripheral nodes + hub glow + 2 background circles
    expect(svg.querySelectorAll('circle').length).toBe(7)
  })

  it('uses the canonical wordmark colors (Home #e6edf3 / lable #00d4ff)', () => {
    render(<Logo showText />)
    expect(screen.getByText('Home')).toHaveStyle({ color: '#e6edf3' })
    expect(screen.getByText('lable')).toHaveStyle({ color: '#00d4ff' })
  })

  it('hides the wordmark when showText is false', () => {
    render(<Logo showText={false} />)
    expect(screen.queryByText('Home')).toBeNull()
    expect(screen.getByTestId('logo-mark')).toBeInTheDocument()
  })

  it('scales the svg to the requested size', () => {
    render(<Logo size={64} />)
    const svg = screen.getByTestId('logo-mark')
    expect(svg.getAttribute('width')).toBe('64')
    expect(svg.getAttribute('height')).toBe('64')
  })

  it('generates unique gradient/filter ids per instance — two logos can coexist', () => {
    // Sidebar and Toolbar both render a Logo at the same time; duplicate SVG
    // defs ids would make one instance reference the other's gradient.
    render(<><Logo /><Logo /></>)
    const [first, second] = screen.getAllByTestId('logo-mark')
    const idOf = (svg: HTMLElement) => svg.querySelector('radialGradient')!.getAttribute('id')
    expect(idOf(first)).not.toBe(idOf(second))

    // Each instance must point at its own gradient
    const gradientRef = (svg: HTMLElement) =>
      svg.querySelectorAll('circle')[1].getAttribute('fill')
    expect(gradientRef(first)).toBe(`url(#${idOf(first)!})`)
    expect(gradientRef(second)).toBe(`url(#${idOf(second)!})`)
  })

  it('marks the svg aria-hidden — the adjacent wordmark carries the name', () => {
    render(<Logo />)
    expect(screen.getByTestId('logo-mark')).toHaveAttribute('aria-hidden', 'true')
  })

  it('forwards className to the wrapper', () => {
    const { container } = render(<Logo className="my-class" />)
    expect(container.firstElementChild).toHaveClass('my-class')
  })
})

import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Server } from 'lucide-react'
import { IconImage } from '../IconImage'
import { NodeIcon } from '../NodeIcon'
import { ServiceIcon } from '../ServiceIcon'

const LINK = 'https://cdn.jsdelivr.net/gh/selfhst/icons/svg/immich.svg'

describe('IconImage', () => {
  it('renders the image without sending a referrer', () => {
    render(<IconImage src={LINK} alt="immich" size={16} />)
    const img = screen.getByAltText('immich')
    expect(img.getAttribute('src')).toBe(LINK)
    expect(img.getAttribute('referrerpolicy')).toBe('no-referrer')
  })

  it('swaps to the fallback when the image fails to load', () => {
    render(<IconImage src={LINK} alt="immich" size={16} fallback={<span>fallback</span>} />)
    fireEvent.error(screen.getByAltText('immich'))
    expect(screen.queryByAltText('immich')).toBeNull()
    expect(screen.getByText('fallback')).toBeDefined()
  })

  it('gives a new src its own chance after a failure', () => {
    const { rerender } = render(<IconImage src={LINK} alt="icon" size={16} />)
    fireEvent.error(screen.getByAltText('icon'))
    expect(screen.queryByAltText('icon')).toBeNull()
    rerender(<IconImage src="https://example.com/other.png" alt="icon" size={16} />)
    expect(screen.getByAltText('icon').getAttribute('src')).toBe('https://example.com/other.png')
  })
})

describe('NodeIcon with a url key', () => {
  it('renders the custom link', () => {
    render(<NodeIcon typeIcon={Server} customIconKey={`url:${LINK}`} />)
    expect(screen.getByAltText('immich').getAttribute('src')).toBe(LINK)
  })

  it('falls back to the type icon when the link is dead', () => {
    const { container } = render(<NodeIcon typeIcon={Server} customIconKey={`url:${LINK}`} />)
    fireEvent.error(screen.getByAltText('immich'))
    expect(screen.queryByAltText('immich')).toBeNull()
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('renders the type icon for a tampered url key', () => {
    const { container } = render(<NodeIcon typeIcon={Server} customIconKey="url:javascript:alert(1)" />)
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('svg')).not.toBeNull()
  })
})

describe('ServiceIcon with a url key', () => {
  it('renders the custom link', () => {
    render(<ServiceIcon iconKey={`url:${LINK}`} />)
    expect(screen.getByAltText('immich').getAttribute('src')).toBe(LINK)
  })

  it('renders nothing once the link fails', () => {
    const { container } = render(<ServiceIcon iconKey={`url:${LINK}`} />)
    fireEvent.error(screen.getByAltText('immich'))
    expect(container.innerHTML).toBe('')
  })
})

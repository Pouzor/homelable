import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { renderWithProviders, screen, fireEvent, cleanup, act } from '@/test/render'
import { WalkthroughOverlay } from '../WalkthroughOverlay'
import { getSteps } from '../steps'
import { useWalkthroughStore } from '@/stores/walkthroughStore'

const TOTAL = getSteps(false).length

const startTour = () => act(() => { useWalkthroughStore.getState().start() })

beforeEach(() => {
  localStorage.clear()
  useWalkthroughStore.setState({ isActive: false, stepIndex: 0, total: 0 })
})
afterEach(() => cleanup())

describe('WalkthroughOverlay', () => {
  it('renders nothing while inactive', () => {
    renderWithProviders(<WalkthroughOverlay />)
    expect(screen.queryByText('Welcome to Homelable')).not.toBeInTheDocument()
  })

  it('shows the first step and progress when active', () => {
    renderWithProviders(<WalkthroughOverlay />)
    startTour()
    expect(screen.getByText('Welcome to Homelable')).toBeInTheDocument()
    expect(screen.getByText(`1/${TOTAL}`)).toBeInTheDocument()
  })

  it('advances and rewinds between steps', () => {
    renderWithProviders(<WalkthroughOverlay />)
    startTour()
    fireEvent.click(screen.getByText('Next'))
    expect(screen.getByText('Scan your network')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Previous step'))
    expect(screen.getByText('Welcome to Homelable')).toBeInTheDocument()
  })

  it('lets the progress strip give way, not the Next button', () => {
    renderWithProviders(<WalkthroughOverlay />)
    startTour()

    const dots = screen.getByTestId('walkthrough-progress')
    expect(dots.children).toHaveLength(TOTAL)
    // The card is a fixed 320px, so one dot per step eventually outgrows the
    // footer. The strip shrinks and clips; the counter and buttons hold their
    // size, or Next lands outside the card.
    expect(dots.className).toContain('min-w-0')
    expect(dots.className).toContain('overflow-hidden')
    expect(screen.getByText('Next').closest('div')?.className).toContain('shrink-0')
  })

  it('skip closes the overlay', () => {
    renderWithProviders(<WalkthroughOverlay />)
    startTour()
    fireEvent.click(screen.getByLabelText('Skip walkthrough'))
    expect(useWalkthroughStore.getState().isActive).toBe(false)
    expect(screen.queryByText('Welcome to Homelable')).not.toBeInTheDocument()
  })
})

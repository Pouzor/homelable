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

  it('skip closes the overlay', () => {
    renderWithProviders(<WalkthroughOverlay />)
    startTour()
    fireEvent.click(screen.getByLabelText('Skip walkthrough'))
    expect(useWalkthroughStore.getState().isActive).toBe(false)
    expect(screen.queryByText('Welcome to Homelable')).not.toBeInTheDocument()
  })
})

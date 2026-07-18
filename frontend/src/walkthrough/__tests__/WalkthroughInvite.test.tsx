import { describe, it, expect, beforeEach } from 'vitest'
import { renderWithProviders, screen, fireEvent } from '@/test/render'
import { WalkthroughInvite } from '../WalkthroughInvite'
import { useWalkthroughStore } from '@/stores/walkthroughStore'
import { readWalkthrough } from '@/utils/walkthrough'

beforeEach(() => {
  localStorage.clear()
  useWalkthroughStore.setState({ isActive: false, stepIndex: 0, total: 0 })
})

describe('WalkthroughInvite', () => {
  it('offers the tour to a new user', () => {
    renderWithProviders(<WalkthroughInvite />)
    expect(screen.getByText('New here? Take the tour')).toBeInTheDocument()
  })

  it('is hidden once already seen', () => {
    localStorage.setItem('homelable.walkthrough', JSON.stringify({ seenVersion: 1, status: 'completed' }))
    renderWithProviders(<WalkthroughInvite />)
    expect(screen.queryByText('New here? Take the tour')).not.toBeInTheDocument()
  })

  it('"Getting started" launches the tour', () => {
    renderWithProviders(<WalkthroughInvite />)
    fireEvent.click(screen.getByText('Getting started'))
    expect(useWalkthroughStore.getState().isActive).toBe(true)
    // Invite hides while the tour is active.
    expect(screen.queryByText('New here? Take the tour')).not.toBeInTheDocument()
  })

  it('"Don\'t show again" persists and hides', () => {
    renderWithProviders(<WalkthroughInvite />)
    fireEvent.click(screen.getByText("Don't show again"))
    expect(readWalkthrough().status).toBe('skipped')
    expect(screen.queryByText('New here? Take the tour')).not.toBeInTheDocument()
  })

  it('"Not now" hides without persisting', () => {
    renderWithProviders(<WalkthroughInvite />)
    fireEvent.click(screen.getByLabelText('Not now'))
    expect(screen.queryByText('New here? Take the tour')).not.toBeInTheDocument()
    // Not persisted → would be offered again on next load.
    expect(readWalkthrough().seenVersion).toBeNull()
  })
})

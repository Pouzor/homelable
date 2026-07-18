import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  WALKTHROUGH_VERSION,
  readWalkthrough,
  writeWalkthrough,
  subscribeWalkthrough,
  shouldOfferWalkthrough,
  markWalkthroughSeen,
  resetWalkthrough,
} from '../walkthrough'

beforeEach(() => localStorage.clear())

describe('readWalkthrough', () => {
  it('defaults to pending / unseen when nothing is stored', () => {
    expect(readWalkthrough()).toEqual({ seenVersion: null, status: 'pending' })
  })

  it('round-trips written state', () => {
    writeWalkthrough({ seenVersion: 3, status: 'completed' })
    expect(readWalkthrough()).toEqual({ seenVersion: 3, status: 'completed' })
  })

  it('falls back to defaults on malformed json', () => {
    localStorage.setItem('homelable.walkthrough', '{not json')
    expect(readWalkthrough()).toEqual({ seenVersion: null, status: 'pending' })
  })
})

describe('shouldOfferWalkthrough', () => {
  it('offers a brand-new user (seenVersion null)', () => {
    expect(shouldOfferWalkthrough()).toBe(true)
  })

  it('offers an upgrader whose seen version is behind', () => {
    writeWalkthrough({ seenVersion: WALKTHROUGH_VERSION - 1, status: 'completed' })
    expect(shouldOfferWalkthrough()).toBe(true)
  })

  it('stops offering once the current version is stamped', () => {
    markWalkthroughSeen('completed')
    expect(shouldOfferWalkthrough()).toBe(false)
    expect(readWalkthrough().seenVersion).toBe(WALKTHROUGH_VERSION)
  })
})

describe('resetWalkthrough', () => {
  it('re-offers after a reset', () => {
    markWalkthroughSeen('skipped')
    expect(shouldOfferWalkthrough()).toBe(false)
    resetWalkthrough()
    expect(shouldOfferWalkthrough()).toBe(true)
  })
})

describe('subscribeWalkthrough', () => {
  it('notifies listeners on write and unsubscribes cleanly', () => {
    const spy = vi.fn()
    const unsub = subscribeWalkthrough(spy)
    writeWalkthrough({ seenVersion: 1, status: 'completed' })
    expect(spy).toHaveBeenCalledWith({ seenVersion: 1, status: 'completed' })
    unsub()
    writeWalkthrough({ seenVersion: 2, status: 'skipped' })
    expect(spy).toHaveBeenCalledTimes(1)
  })
})

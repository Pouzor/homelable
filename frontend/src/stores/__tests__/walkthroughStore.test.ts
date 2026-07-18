import { describe, it, expect, beforeEach } from 'vitest'
import { useWalkthroughStore } from '../walkthroughStore'
import { readWalkthrough, WALKTHROUGH_VERSION } from '@/utils/walkthrough'

beforeEach(() => {
  localStorage.clear()
  useWalkthroughStore.setState({ isActive: false, stepIndex: 0, total: 0 })
})

describe('walkthroughStore', () => {
  it('start activates at step 0', () => {
    useWalkthroughStore.getState().start()
    const s = useWalkthroughStore.getState()
    expect(s.isActive).toBe(true)
    expect(s.stepIndex).toBe(0)
  })

  it('next advances and finishes past the last step', () => {
    const store = useWalkthroughStore.getState()
    store.start()
    store.setTotal(3)
    store.next()
    expect(useWalkthroughStore.getState().stepIndex).toBe(1)
    store.next()
    expect(useWalkthroughStore.getState().stepIndex).toBe(2)
    // At the last step, next() finishes the tour and stamps it completed.
    store.next()
    expect(useWalkthroughStore.getState().isActive).toBe(false)
    expect(readWalkthrough()).toEqual({ seenVersion: WALKTHROUGH_VERSION, status: 'completed' })
  })

  it('prev clamps at 0', () => {
    const store = useWalkthroughStore.getState()
    store.start()
    store.setTotal(3)
    store.prev()
    expect(useWalkthroughStore.getState().stepIndex).toBe(0)
  })

  it('goTo clamps within [0, total-1]', () => {
    const store = useWalkthroughStore.getState()
    store.start()
    store.setTotal(3)
    store.goTo(9)
    expect(useWalkthroughStore.getState().stepIndex).toBe(2)
    store.goTo(-1)
    expect(useWalkthroughStore.getState().stepIndex).toBe(0)
  })

  it('skip deactivates and stamps skipped', () => {
    const store = useWalkthroughStore.getState()
    store.start()
    store.skip()
    expect(useWalkthroughStore.getState().isActive).toBe(false)
    expect(readWalkthrough().status).toBe('skipped')
    expect(readWalkthrough().seenVersion).toBe(WALKTHROUGH_VERSION)
  })
})

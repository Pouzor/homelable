import { create } from 'zustand'
import { markWalkthroughSeen } from '@/utils/walkthrough'

/**
 * Runtime state of an active Getting Started tour. Persistence of the "already
 * seen" flag lives in utils/walkthrough.ts; this store only tracks the live run.
 *
 * `total` is set by the overlay from the mode-filtered step list, so next()/goTo
 * can clamp and finish() fires when the user advances past the last step.
 */
interface WalkthroughStore {
  isActive: boolean
  stepIndex: number
  total: number
  setTotal: (n: number) => void
  start: () => void
  next: () => void
  prev: () => void
  goTo: (n: number) => void
  skip: () => void
  finish: () => void
}

export const useWalkthroughStore = create<WalkthroughStore>((set, get) => ({
  isActive: false,
  stepIndex: 0,
  total: 0,
  setTotal: (n) => set({ total: n }),
  start: () => set({ isActive: true, stepIndex: 0 }),
  next: () => {
    const { stepIndex, total } = get()
    if (stepIndex >= total - 1) {
      get().finish()
      return
    }
    set({ stepIndex: stepIndex + 1 })
  },
  prev: () => set((s) => ({ stepIndex: Math.max(0, s.stepIndex - 1) })),
  goTo: (n) => set((s) => ({ stepIndex: Math.max(0, Math.min(n, Math.max(0, s.total - 1))) })),
  skip: () => {
    markWalkthroughSeen('skipped')
    set({ isActive: false })
  },
  finish: () => {
    markWalkthroughSeen('completed')
    set({ isActive: false })
  },
}))

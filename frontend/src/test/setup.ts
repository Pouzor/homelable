import '@testing-library/jest-dom'
import { afterEach } from 'vitest'

// Zustand persist middleware requires localStorage. jsdom provides it but
// some test runners strip it — ensure a working implementation is always present.
const store: Record<string, string> = {}
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v },
    removeItem: (k: string) => { delete store[k] },
    clear: () => { Object.keys(store).forEach((k) => delete store[k]) },
  },
  writable: true,
})

// Persisted UI preferences (cable view, hover highlight, autosave…) must not
// leak from one test into the next: each test starts from empty storage.
afterEach(() => localStorage.clear())

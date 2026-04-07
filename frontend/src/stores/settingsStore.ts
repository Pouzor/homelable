import { create } from 'zustand'

interface AppSettingsState {
  intervalSeconds: number
  setSettings: (settings: { intervalSeconds: number }) => void
}

export const useSettingsStore = create<AppSettingsState>((set) => ({
  intervalSeconds: 60,
  setSettings: ({ intervalSeconds }) => set({ intervalSeconds }),
}))

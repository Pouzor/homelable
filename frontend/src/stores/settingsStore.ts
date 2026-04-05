import { create } from 'zustand'

interface AppSettingsState {
  intervalSeconds: number
  scanIntervalSeconds: number
  defaultNodeColor: string | null
  defaultEdgeColor: string | null
  nodeTypeColors: Record<string, string>
  edgeTypeColors: Record<string, string>
  setSettings: (settings: {
    intervalSeconds: number
    scanIntervalSeconds: number
    defaultNodeColor: string | null
    defaultEdgeColor: string | null
    nodeTypeColors: Record<string, string>
    edgeTypeColors: Record<string, string>
  }) => void
}

export const useSettingsStore = create<AppSettingsState>((set) => ({
  intervalSeconds: 60,
  scanIntervalSeconds: 3600,
  defaultNodeColor: null,
  defaultEdgeColor: null,
  nodeTypeColors: {},
  edgeTypeColors: {},
  setSettings: ({ intervalSeconds, scanIntervalSeconds, defaultNodeColor, defaultEdgeColor, nodeTypeColors, edgeTypeColors }) =>
    set({ intervalSeconds, scanIntervalSeconds, defaultNodeColor, defaultEdgeColor, nodeTypeColors, edgeTypeColors }),
}))

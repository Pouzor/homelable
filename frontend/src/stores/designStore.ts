import { create } from 'zustand'
import type { Design, DesignType } from '@/types'

interface DesignState {
  designs: Design[]
  activeDesignId: string | null
  activeDesignType: DesignType | null
  loaded: boolean
  setDesigns: (designs: Design[]) => void
  setActiveDesign: (id: string) => void
  getActiveDesign: () => Design | null
}

export const useDesignStore = create<DesignState>((set, get) => ({
  designs: [],
  activeDesignId: null,
  activeDesignType: null,
  loaded: false,

  setDesigns: (designs) =>
    set((state) => {
      const nextId = state.activeDesignId && designs.find((d) => d.id === state.activeDesignId)
        ? state.activeDesignId
        : designs[0]?.id ?? null
      const nextType = nextId ? designs.find((d) => d.id === nextId)?.design_type ?? null : null
      return { designs, activeDesignId: nextId, activeDesignType: nextType, loaded: true }
    }),

  setActiveDesign: (id) =>
    set((state) => {
      const design = state.designs.find((d) => d.id === id)
      return {
        activeDesignId: id,
        activeDesignType: design?.design_type ?? null,
      }
    }),

  getActiveDesign: () => {
    const { designs, activeDesignId } = get()
    return designs.find((d) => d.id === activeDesignId) ?? null
  },
}))

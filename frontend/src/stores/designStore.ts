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
  /** Append a new design and make it active. */
  addDesign: (design: Design) => void
  /** Patch an existing design in place (name/icon edits). */
  updateDesign: (id: string, patch: Partial<Pick<Design, 'name' | 'icon'>>) => void
  /** Remove a design; if it was active, fall back to the first remaining one. */
  removeDesign: (id: string) => void
  /**
   * Put the list in `ids` order. Ids not in the list are ignored, and designs
   * the order does not name keep their relative place at the end, so a stale
   * order can never drop a canvas.
   */
  reorderDesigns: (ids: string[]) => void
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

  addDesign: (design) =>
    set((state) => ({
      designs: [...state.designs, design],
      activeDesignId: design.id,
      activeDesignType: design.design_type,
    })),

  updateDesign: (id, patch) =>
    set((state) => ({
      designs: state.designs.map((d) => (d.id === id ? { ...d, ...patch } : d)),
    })),

  removeDesign: (id) =>
    set((state) => {
      const designs = state.designs.filter((d) => d.id !== id)
      if (state.activeDesignId !== id) return { designs }
      const next = designs[0] ?? null
      return {
        designs,
        activeDesignId: next?.id ?? null,
        activeDesignType: next?.design_type ?? null,
      }
    }),

  reorderDesigns: (ids) =>
    set((state) => {
      const byId = new Map(state.designs.map((d) => [d.id, d]))
      const ordered = ids.flatMap((id) => {
        const d = byId.get(id)
        if (!d) return []
        byId.delete(id)
        return [d]
      })
      return { designs: [...ordered, ...byId.values()] }
    }),
}))

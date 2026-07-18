import { createContext, useContext } from 'react'

/**
 * Bridge between tour steps and the App's modal/canvas controls. App builds the
 * concrete implementation from its useState setters and provides it here; the
 * overlay resolves each step's `action` string to a function on this object.
 *
 * `closeAll` is called before every step's action so leftover modals from the
 * previous step are dismissed.
 *
 * Grows as steps land (openInventoryDemo, editDemoNode, openStyle, …).
 */
export interface WalkthroughActionApi {
  closeAll: () => void
  openScanConfig: () => void
  openScanHistoryDemo: () => void
  openInventoryDemo: () => void
  editFirstNode: () => void
  selectTwoNodes: () => void
  openStyle: () => void
  openZigbeeImport: () => void
}

const WalkthroughActionsContext = createContext<WalkthroughActionApi | null>(null)

export const WalkthroughActionsProvider = WalkthroughActionsContext.Provider

export function useWalkthroughActions(): WalkthroughActionApi | null {
  return useContext(WalkthroughActionsContext)
}

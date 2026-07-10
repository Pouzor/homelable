/* eslint-disable react-refresh/only-export-components -- test helper module, not a component module */
/**
 * Custom render that wraps the UI in the same providers the app mounts
 * (`TooltipProvider`, `ReactFlowProvider`), so component tests that touch
 * React Flow context or tooltips don't each re-declare the wrapper.
 *
 * Re-exports everything from `@testing-library/react`, so a test can:
 *   import { renderWithProviders, screen } from '@/test/render'
 *
 * Use the plain `render` from `@testing-library/react` for pure presentational
 * components that need no context. See CLAUDE.md → Testing Protocol.
 */
import type { ReactElement, ReactNode } from 'react'
import { render, type RenderOptions } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { TooltipProvider } from '@/components/ui/tooltip'

function AllProviders({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider>
      <ReactFlowProvider>{children}</ReactFlowProvider>
    </TooltipProvider>
  )
}

export function renderWithProviders(ui: ReactElement, options?: Omit<RenderOptions, 'wrapper'>) {
  return render(ui, { wrapper: AllProviders, ...options })
}

export * from '@testing-library/react'

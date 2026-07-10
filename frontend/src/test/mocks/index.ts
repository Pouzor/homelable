/**
 * Reusable mock builders. Consume them from an *async* `vi.mock` factory via
 * dynamic import so the boilerplate lives in one place:
 *
 *   vi.mock('sonner', async () => (await import('@/test/mocks')).mockSonner())
 *
 * `vi.mock` factories are hoisted above the file's imports, so a plain
 * top-level `import { mockSonner }` referenced inside the factory throws
 * "cannot access before initialization". The dynamic `import()` sidesteps
 * that — it resolves lazily when the mocked module is first loaded.
 *
 * See CLAUDE.md → Testing Protocol.
 */
import { vi } from 'vitest'

/** `sonner` toast stub. Assert via `import { toast } from 'sonner'`. */
export function mockSonner() {
  return {
    toast: {
      success: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warning: vi.fn(),
      message: vi.fn(),
      loading: vi.fn(),
      dismiss: vi.fn(),
    },
  }
}

/**
 * `@xyflow/react` stub covering the exports most node/edge component tests
 * need. Pass `extra` to add or override exports for a specific test.
 */
export function mockReactFlow(extra: Record<string, unknown> = {}) {
  return {
    Handle: () => null,
    Position: { Top: 'top', Bottom: 'bottom', Left: 'left', Right: 'right' },
    NodeResizer: () => null,
    NodeToolbar: () => null,
    BaseEdge: () => null,
    EdgeLabelRenderer: ({ children }: { children?: unknown }) => children ?? null,
    useUpdateNodeInternals: () => vi.fn(),
    useViewport: () => ({ x: 0, y: 0, zoom: 1 }),
    useReactFlow: () => ({
      getNode: vi.fn(),
      getNodes: vi.fn(() => []),
      getEdges: vi.fn(() => []),
      screenToFlowPosition: vi.fn((p: unknown) => p),
    }),
    getBezierPath: () => ['M0,0', 0, 0] as const,
    getSmoothStepPath: () => ['M0,0', 0, 0] as const,
    ...extra,
  }
}

/**
 * Build a `useCanvasStore` replacement for component tests that only read a
 * selected slice of store state. Returns a function usable as the hook: it
 * invokes the passed selector against `state` (falling back to returning the
 * whole state when called with no selector).
 */
export function makeUseCanvasStore<S extends Record<string, unknown>>(state: S) {
  return <R>(selector?: (s: S) => R): R | S => (selector ? selector(state) : state)
}

/** Common `serviceStatusKey` helper mirrored from the real store. */
export function serviceStatusKey(nodeId: string, port?: number, protocol?: string) {
  return `${nodeId}:${port ?? ''}/${protocol ?? ''}`
}

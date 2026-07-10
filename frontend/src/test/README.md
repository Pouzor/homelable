# Frontend test infrastructure

Shared helpers so tests don't re-roll the same boilerplate. Reuse these instead
of redefining a local `makeNode`, sonner mock, or provider wrapper per file.

## `factories.ts` — fixture builders

```ts
import { makeNode, makeEdge, makeNodeData, makeDesign } from '@/test/factories'

makeNode('n1', { type: 'router', ip: '10.0.0.1' })   // React Flow node
makeNode({ data: makeNodeData({ label: 'X' }) })      // partial-node form
makeEdge('e1', 'n1', 'n2', { type: 'wifi' })          // React Flow edge
makeDesign({ name: 'Home' })                          // Design row
```

Prefer these over an inline `const makeNode = …`. They track the domain types in
`@/types`, so a type change surfaces in one place.

## `mocks/` — reusable mock builders

Consume from an **async** `vi.mock` factory via dynamic import. `vi.mock`
factories are hoisted above the file's imports, so a plain top-level
`import { mockSonner }` referenced inside the factory throws "cannot access
before initialization". The dynamic `import()` resolves lazily and sidesteps it:

```ts
vi.mock('sonner', async () => (await import('@/test/mocks')).mockSonner())
vi.mock('@xyflow/react', async () => (await import('@/test/mocks')).mockReactFlow())

import { toast } from 'sonner'
// …assert vi.mocked(toast.success) etc.
```

- `mockSonner()` — full `toast` stub (success/error/info/warning/…).
- `mockReactFlow(extra?)` — the `@xyflow/react` exports most node/edge tests
  need; pass `extra` to add or override an export.
- `makeUseCanvasStore(state)` — a `useCanvasStore` replacement for component
  tests that read a selected slice.

## `render.tsx` — provider-wrapped render

```ts
import { renderWithProviders, screen } from '@/test/render'
renderWithProviders(<NodeDetail … />)   // wraps TooltipProvider + ReactFlowProvider
```

Use the plain `render` from `@testing-library/react` for presentational
components that need no context.

## Conventions

- **Store tests are split by concern** under `stores/__tests__/canvasStore/`
  (nodes, containers, sizing, edges, selection, grouping, history, clipboard,
  customStyle, floorMap). Add new store tests to the matching file; don't grow a
  monolith.
- When a component test full-mocks a store (`vi.mock('@/stores/canvasStore')`),
  still assert the **state-driven UI branches** (disabled buttons, indicators) —
  don't let the mock hide that wiring.

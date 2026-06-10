import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import type { EdgeProps, Edge } from '@xyflow/react'
import type { EdgeData } from '@/types'

/**
 * Issue #183 — connection labels must support multiple lines.
 *
 * The label is a free-text string; newlines entered in the EdgeModal textarea
 * are stored verbatim. The rendered label div must preserve those newlines
 * (`whitespace-pre-line`) instead of collapsing them into a single line.
 *
 * <EdgeLabelRenderer> normally portals into a node that only exists inside a
 * full <ReactFlow> host, so we stub it to a passthrough to render the label
 * markup directly.
 */
vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xyflow/react')>()
  return {
    ...actual,
    EdgeLabelRenderer: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  }
})

const { HomelableEdge } = await import('../index')

function renderEdge(data: Partial<EdgeData> = {}) {
  const props = {
    id: 'e1',
    source: 'a',
    target: 'b',
    sourceX: 0,
    sourceY: 0,
    targetX: 100,
    targetY: 100,
    sourcePosition: 'bottom',
    targetPosition: 'top',
    data: { type: 'ethernet', ...data } as EdgeData,
    selected: false,
  } as unknown as EdgeProps<Edge<EdgeData>>

  return render(
    <ReactFlowProvider>
      <svg>
        <HomelableEdge {...props} />
      </svg>
    </ReactFlowProvider>,
  )
}

describe('HomelableEdge label', () => {
  it('renders the label text', () => {
    const { getByText } = renderEdge({ label: 'uplink' })
    expect(getByText('uplink')).toBeTruthy()
  })

  it('preserves newlines in the rendered label (issue #183)', () => {
    const { container } = renderEdge({ label: 'line one\nline two' })
    const label = Array.from(container.querySelectorAll('div.whitespace-pre-line')).find((d) =>
      d.textContent === 'line one\nline two',
    )
    expect(label).toBeTruthy()
  })

  it('renders no label div when label is empty', () => {
    const { container } = renderEdge({ label: undefined })
    expect(container.querySelector('div.whitespace-pre-line')).toBeNull()
  })
})

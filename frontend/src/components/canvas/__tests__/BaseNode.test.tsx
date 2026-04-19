import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Server } from 'lucide-react'
import { BaseNode } from '../nodes/BaseNode'
import type { NodeData } from '@/types'
import type { Node } from '@xyflow/react'

let mockZoom = 1

vi.mock('@xyflow/react', () => ({
  Handle: () => null,
  Position: { Top: 'top', Bottom: 'bottom' },
  NodeResizer: () => null,
  useUpdateNodeInternals: () => vi.fn(),
  useViewport: () => ({ zoom: mockZoom }),
}))

vi.mock('@/stores/themeStore', () => ({
  useThemeStore: (sel: (s: { activeTheme: string }) => unknown) => sel({ activeTheme: 'dark' }),
}))

vi.mock('@/stores/canvasStore', () => ({
  useCanvasStore: (sel: (s: { hideIp: boolean }) => unknown) => sel({ hideIp: false }),
}))

vi.mock('@/utils/themes', () => ({
  THEMES: {
    dark: {
      colors: {
        statusColors: { online: '#39d353', offline: '#f85149', pending: '#e3b341', unknown: '#8b949e' },
        nodeSubtextColor: '#8b949e',
        nodeLabelColor: '#e6edf3',
        nodeIconBackground: '#21262d',
        handleBackground: '#30363d',
        handleBorder: '#30363d',
      },
    },
  },
}))

vi.mock('@/utils/nodeColors', () => ({
  resolveNodeColors: () => ({ background: '#161b22', border: '#30363d', icon: '#00d4ff' }),
}))

vi.mock('@/utils/nodeIcons', () => ({
  resolveNodeIcon: (_typeIcon: unknown) => _typeIcon,
}))

vi.mock('@/utils/maskIp', () => ({
  maskIp: (ip: string) => ip,
}))

vi.mock('@/utils/propertyIcons', () => ({
  resolvePropertyIcon: (icon: string | null) => icon ? Server : null,
}))

vi.mock('@/utils/handleUtils', () => ({
  BOTTOM_HANDLE_IDS: ['bottom'],
  BOTTOM_HANDLE_POSITIONS: { 1: [50] },
}))

beforeEach(() => { mockZoom = 1 })

function makeNode(data: Partial<NodeData>): Node<NodeData> {
  return {
    id: 'n1',
    type: data.type ?? 'server',
    position: { x: 0, y: 0 },
    data: {
      label: 'Test Node',
      type: 'server',
      status: 'online',
      services: [],
      ...data,
    },
  }
}

function renderBaseNode(data: Partial<NodeData>) {
  const node = makeNode(data)
  return render(
    <BaseNode
      id={node.id}
      data={node.data}
      selected={false}
      icon={Server}
      type="server"
      dragging={false}
      zIndex={0}
      isConnectable={true}
      positionAbsoluteX={0}
      positionAbsoluteY={0}
    />
  )
}

describe('BaseNode — borderWidth zoom scaling', () => {
  beforeEach(() => { mockZoom = 1 })

  it('borderWidth is 1px at zoom=1', () => {
    mockZoom = 1
    const { container } = renderBaseNode({})
    expect((container.firstChild as HTMLElement).style.borderWidth).toBe('1px')
  })

  it('borderWidth scales to 2px at zoom=0.5', () => {
    mockZoom = 0.5
    const { container } = renderBaseNode({})
    expect((container.firstChild as HTMLElement).style.borderWidth).toBe('2px')
  })

  it('borderWidth is clamped to 1px at zoom=2', () => {
    mockZoom = 2
    const { container } = renderBaseNode({})
    expect((container.firstChild as HTMLElement).style.borderWidth).toBe('1px')
  })

  it('boxShadow glow ring uses borderWidth when selected + online at zoom=0.5', () => {
    mockZoom = 0.5
    const node = makeNode({ status: 'online' })
    const { container } = render(
      <BaseNode id={node.id} data={node.data} selected={true} icon={Server}
        type="server" dragging={false} zIndex={0} isConnectable={true}
        positionAbsoluteX={0} positionAbsoluteY={0} />
    )
    expect((container.firstChild as HTMLElement).style.boxShadow).toContain('0 0 0 2px')
  })
})

describe('BaseNode — properties rendering', () => {
  it('renders visible properties on the node', () => {
    renderBaseNode({
      properties: [
        { key: 'CPU Model', value: 'i7-12700K', icon: 'Cpu', visible: true },
        { key: 'RAM', value: '32 GB', icon: 'MemoryStick', visible: true },
      ],
    })
    expect(screen.getByText('CPU Model')).toBeDefined()
    // Value is rendered with a middle-dot prefix: "· 32 GB"
    expect(screen.getByText(/32 GB/)).toBeDefined()
  })

  it('does not render properties with visible=false', () => {
    renderBaseNode({
      properties: [
        { key: 'Secret', value: 'hidden', icon: null, visible: false },
      ],
    })
    expect(screen.queryByText('Secret')).toBeNull()
  })

  it('renders nothing when properties array is empty', () => {
    const { container } = renderBaseNode({ properties: [] })
    // No properties section — only the main node card
    expect(container.querySelectorAll('.flex.flex-col.gap-1').length).toBe(0)
  })

  it('renders label and ip regardless of properties', () => {
    renderBaseNode({
      label: 'My Server',
      ip: '192.168.1.10',
      properties: [{ key: 'OS', value: 'Debian 12', icon: 'Server', visible: true }],
    })
    expect(screen.getByText('My Server')).toBeDefined()
    expect(screen.getByText('192.168.1.10')).toBeDefined()
    expect(screen.getByText('OS')).toBeDefined()
  })
})

describe('BaseNode — legacy hardware fallback', () => {
  it('renders legacy hardware when properties is undefined and show_hardware is true', () => {
    renderBaseNode({
      properties: undefined,
      show_hardware: true,
      cpu_model: 'Intel Xeon E5-2680',
      ram_gb: 32,
    })
    expect(screen.getByText('Intel Xeon E5-2680')).toBeDefined()
  })

  it('does not render legacy hardware when properties array is present (even if empty)', () => {
    renderBaseNode({
      properties: [],
      show_hardware: true,
      cpu_model: 'Intel Xeon E5-2680',
    })
    // properties array exists → new system, legacy section skipped
    expect(screen.queryByText('Intel Xeon E5-2680')).toBeNull()
  })

  it('does not render legacy hardware when show_hardware is false', () => {
    renderBaseNode({
      properties: undefined,
      show_hardware: false,
      cpu_model: 'Intel Xeon E5-2680',
    })
    expect(screen.queryByText('Intel Xeon E5-2680')).toBeNull()
  })
})

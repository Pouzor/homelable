import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CustomStyleModal } from '../CustomStyleModal'
import { useThemeStore } from '@/stores/themeStore'
import { useCanvasStore } from '@/stores/canvasStore'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))
import { toast } from 'sonner'

describe('CustomStyleModal', () => {
  beforeEach(() => {
    useThemeStore.setState({ customStyle: { nodes: {}, edges: {} } })
    useCanvasStore.setState({ hasUnsavedChanges: false })
    vi.mocked(toast.success).mockReset()
  })

  it('renders nothing when closed', () => {
    const { container } = render(<CustomStyleModal open={false} onClose={vi.fn()} />)
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })

  it('renders title and tabs', () => {
    render(<CustomStyleModal open onClose={vi.fn()} />)
    expect(screen.getByText('Custom Style Editor')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Nodes' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Edges' })).toBeDefined()
  })

  it('starts with empty selection placeholder', () => {
    render(<CustomStyleModal open onClose={vi.fn()} />)
    expect(screen.getByText(/Select a node type/)).toBeDefined()
  })

  it('switches to edges tab and shows the right placeholder', () => {
    render(<CustomStyleModal open onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edges' }))
    expect(screen.getByText(/edge type from the list/i)).toBeDefined()
  })

  it('selecting a node type opens the node editor', () => {
    render(<CustomStyleModal open onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Router' }))
    expect(screen.getByText(/Apply to existing/)).toBeDefined()
    expect(screen.getByText('Default size')).toBeDefined()
  })

  it('selecting an edge type opens the edge editor with path style buttons', () => {
    render(<CustomStyleModal open onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edges' }))
    fireEvent.click(screen.getByRole('button', { name: /Ethernet/ }))
    expect(screen.getByRole('button', { name: 'Bezier' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Smooth' })).toBeDefined()
  })

  it('Apply-to-existing node button calls store and toasts', () => {
    const applyTypeNodeStyle = vi.fn()
    useCanvasStore.setState({ applyTypeNodeStyle })
    render(<CustomStyleModal open onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Router' }))
    fireEvent.click(screen.getByRole('button', { name: /Apply to existing Router/ }))
    expect(applyTypeNodeStyle).toHaveBeenCalledOnce()
    expect(applyTypeNodeStyle.mock.calls[0][0]).toBe('router')
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('Router'))
  })

  it('Apply-to-existing edge button calls store and toasts', () => {
    const applyTypeEdgeStyle = vi.fn()
    useCanvasStore.setState({ applyTypeEdgeStyle })
    render(<CustomStyleModal open onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edges' }))
    fireEvent.click(screen.getByRole('button', { name: /Ethernet/ }))
    fireEvent.click(screen.getByRole('button', { name: /Apply to existing Ethernet/ }))
    expect(applyTypeEdgeStyle).toHaveBeenCalledOnce()
    expect(applyTypeEdgeStyle.mock.calls[0][0]).toBe('ethernet')
  })

  it('Save Custom Style sets customStyle, marks unsaved, closes, toasts', () => {
    const onClose = vi.fn()
    const markUnsaved = vi.fn()
    useCanvasStore.setState({ markUnsaved })
    render(<CustomStyleModal open onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save Custom Style' }))
    expect(markUnsaved).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('Custom style saved'))
  })

  it('Apply All to Canvas calls applyAllCustomStyles, markUnsaved, closes', () => {
    const onClose = vi.fn()
    const markUnsaved = vi.fn()
    const applyAllCustomStyles = vi.fn()
    useCanvasStore.setState({ markUnsaved, applyAllCustomStyles })
    render(<CustomStyleModal open onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Apply All to Canvas' }))
    expect(applyAllCustomStyles).toHaveBeenCalledOnce()
    expect(markUnsaved).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('Cancel button closes without saving', () => {
    const onClose = vi.fn()
    const markUnsaved = vi.fn()
    useCanvasStore.setState({ markUnsaved })
    render(<CustomStyleModal open onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledOnce()
    expect(markUnsaved).not.toHaveBeenCalled()
  })

  it('editing path style updates the edge draft', () => {
    render(<CustomStyleModal open onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edges' }))
    fireEvent.click(screen.getByRole('button', { name: /Ethernet/ }))
    const smoothBtn = screen.getByRole('button', { name: 'Smooth' })
    fireEvent.click(smoothBtn)
    // The clicked button should now be styled selected (cyan border)
    expect(smoothBtn.getAttribute('style')).toContain('rgb(0, 212, 255)')
  })

  it('changing width input updates node draft', () => {
    render(<CustomStyleModal open onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Router' }))
    const widthInputs = screen.getAllByRole('spinbutton')
    fireEvent.change(widthInputs[0], { target: { value: '250' } })
    expect((widthInputs[0] as HTMLInputElement).value).toBe('250')
  })
})

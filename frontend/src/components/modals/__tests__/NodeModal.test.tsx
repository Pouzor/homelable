import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { NodeModal } from '../NodeModal'

describe('NodeModal', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <NodeModal open={false} onClose={vi.fn()} onSubmit={vi.fn()} />
    )
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })

  it('renders form fields when open', () => {
    render(<NodeModal open onClose={vi.fn()} onSubmit={vi.fn()} />)
    expect(screen.getByPlaceholderText('My Server')).toBeDefined()
    expect(screen.getByText('Add Node')).toBeDefined()
  })

  it('does not call onSubmit when label is empty and shows error', () => {
    const onSubmit = vi.fn()
    render(<NodeModal open onClose={vi.fn()} onSubmit={onSubmit} />)
    fireEvent.click(screen.getByText('Add'))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText('Label is required')).toBeDefined()
  })

  it('calls onSubmit with form data when label is filled', () => {
    const onSubmit = vi.fn()
    const onClose = vi.fn()
    render(<NodeModal open onClose={onClose} onSubmit={onSubmit} />)
    fireEvent.change(screen.getByPlaceholderText('My Server'), { target: { value: 'My NAS' } })
    fireEvent.click(screen.getByText('Add'))
    expect(onSubmit).toHaveBeenCalledOnce()
    expect(onSubmit.mock.calls[0][0].label).toBe('My NAS')
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('clears label error when user starts typing', () => {
    render(<NodeModal open onClose={vi.fn()} onSubmit={vi.fn()} />)
    fireEvent.click(screen.getByText('Add'))
    expect(screen.getByText('Label is required')).toBeDefined()
    fireEvent.change(screen.getByPlaceholderText('My Server'), { target: { value: 'x' } })
    expect(screen.queryByText('Label is required')).toBeNull()
  })

  it('pre-fills form from initial prop', () => {
    render(
      <NodeModal open onClose={vi.fn()} onSubmit={vi.fn()} initial={{ label: 'Pre-filled', ip: '10.0.0.1' }} />
    )
    const input = screen.getByPlaceholderText('My Server') as HTMLInputElement
    expect(input.value).toBe('Pre-filled')
  })

  it('shows Save button text when title is Edit Node', () => {
    render(<NodeModal open onClose={vi.fn()} onSubmit={vi.fn()} title="Edit Node" />)
    expect(screen.getByText('Save')).toBeDefined()
  })

  it('calls onClose when Cancel is clicked', () => {
    const onClose = vi.fn()
    render(<NodeModal open onClose={onClose} onSubmit={vi.fn()} />)
    fireEvent.click(screen.getByText('Cancel'))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('submits explicit width and height when provided', () => {
    const onSubmit = vi.fn()
    render(<NodeModal open onClose={vi.fn()} onSubmit={onSubmit} />)
    fireEvent.change(screen.getByPlaceholderText('My Server'), { target: { value: 'Sized Node' } })
    const numericInputs = screen.getAllByRole('spinbutton')
    fireEvent.change(numericInputs[0], { target: { value: '240' } })
    fireEvent.change(numericInputs[1], { target: { value: '100' } })
    fireEvent.click(screen.getByText('Add'))
    expect(onSubmit.mock.calls[0][1]).toEqual({ width: 240, height: 100 })
  })

  it('pre-fills width and height from initialDimensions', () => {
    render(
      <NodeModal
        open
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        initial={{ label: 'Sized' }}
        initialDimensions={{ width: 320, height: 160 }}
      />
    )
    const numericInputs = screen.getAllByRole('spinbutton')
    expect((numericInputs[0] as HTMLInputElement).value).toBe('320')
    expect((numericInputs[1] as HTMLInputElement).value).toBe('160')
  })

  describe('Hardware section', () => {
    it('renders Hardware toggle button', () => {
      render(<NodeModal open onClose={vi.fn()} onSubmit={vi.fn()} />)
      expect(screen.getByText('Hardware')).toBeDefined()
    })

    it('hardware fields are hidden by default', () => {
      render(<NodeModal open onClose={vi.fn()} onSubmit={vi.fn()} />)
      expect(screen.queryByPlaceholderText('e.g. Intel Xeon E5-2680')).toBeNull()
    })

    it('expands hardware fields on toggle click', () => {
      render(<NodeModal open onClose={vi.fn()} onSubmit={vi.fn()} />)
      fireEvent.click(screen.getByText('Hardware'))
      expect(screen.getByPlaceholderText('e.g. Intel Xeon E5-2680')).toBeDefined()
      expect(screen.getByPlaceholderText('e.g. 8')).toBeDefined()
      expect(screen.getByPlaceholderText('e.g. 32')).toBeDefined()
      expect(screen.getByPlaceholderText('e.g. 500')).toBeDefined()
    })

    it('submits hardware fields when filled', () => {
      const onSubmit = vi.fn()
      render(<NodeModal open onClose={vi.fn()} onSubmit={onSubmit} />)
      fireEvent.change(screen.getByPlaceholderText('My Server'), { target: { value: 'Homelab' } })
      fireEvent.click(screen.getByText('Hardware'))
      fireEvent.change(screen.getByPlaceholderText('e.g. Intel Xeon E5-2680'), { target: { value: 'Intel i7-12700K' } })
      fireEvent.change(screen.getByPlaceholderText('e.g. 8'), { target: { value: '12' } })
      fireEvent.change(screen.getByPlaceholderText('e.g. 32'), { target: { value: '64' } })
      fireEvent.change(screen.getByPlaceholderText('e.g. 500'), { target: { value: '2000' } })
      fireEvent.click(screen.getByText('Add'))
      const submitted = onSubmit.mock.calls[0][0]
      expect(submitted.cpu_model).toBe('Intel i7-12700K')
      expect(submitted.cpu_count).toBe(12)
      expect(submitted.ram_gb).toBe(64)
      expect(submitted.disk_gb).toBe(2000)
    })

    it('auto-expands when initial has hardware data', () => {
      render(
        <NodeModal
          open
          onClose={vi.fn()}
          onSubmit={vi.fn()}
          initial={{ label: 'Server', cpu_count: 8, ram_gb: 32 }}
        />
      )
      expect(screen.getByPlaceholderText('e.g. Intel Xeon E5-2680')).toBeDefined()
    })

    it('hides hardware section for groupRect type', () => {
      render(
        <NodeModal
          open
          onClose={vi.fn()}
          onSubmit={vi.fn()}
          initial={{ type: 'groupRect' }}
        />
      )
      expect(screen.queryByText('Hardware')).toBeNull()
    })

    it('show on node toggle is hidden when section is collapsed', () => {
      render(<NodeModal open onClose={vi.fn()} onSubmit={vi.fn()} />)
      expect(screen.queryByText('Show on node')).toBeNull()
    })

    it('show on node toggle appears when section is expanded', () => {
      render(<NodeModal open onClose={vi.fn()} onSubmit={vi.fn()} />)
      fireEvent.click(screen.getByText('Hardware'))
      expect(screen.getByText('Show on node')).toBeDefined()
    })

    it('show_hardware defaults to false', () => {
      const onSubmit = vi.fn()
      render(<NodeModal open onClose={vi.fn()} onSubmit={onSubmit} />)
      fireEvent.change(screen.getByPlaceholderText('My Server'), { target: { value: 'Node' } })
      fireEvent.click(screen.getByText('Add'))
      expect(onSubmit.mock.calls[0][0].show_hardware).toBeFalsy()
    })

    it('toggling show on node sets show_hardware to true', () => {
      const onSubmit = vi.fn()
      render(<NodeModal open onClose={vi.fn()} onSubmit={onSubmit} />)
      fireEvent.change(screen.getByPlaceholderText('My Server'), { target: { value: 'Node' } })
      fireEvent.click(screen.getByText('Hardware'))
      fireEvent.click(screen.getByRole('switch'))
      fireEvent.click(screen.getByText('Add'))
      expect(onSubmit.mock.calls[0][0].show_hardware).toBe(true)
    })

    it('pre-fills show_hardware from initial prop', () => {
      const onSubmit = vi.fn()
      render(
        <NodeModal
          open
          onClose={vi.fn()}
          onSubmit={onSubmit}
          initial={{ label: 'Node', show_hardware: true, cpu_count: 8 }}
        />
      )
      fireEvent.click(screen.getByText('Add'))
      expect(onSubmit.mock.calls[0][0].show_hardware).toBe(true)
    })
  })
})

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { GroupRectModal, type GroupRectFormData } from '../GroupRectModal'

describe('GroupRectModal', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <GroupRectModal open={false} onClose={vi.fn()} onSubmit={vi.fn()} />
    )
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })

  it('renders form fields when open', () => {
    render(<GroupRectModal open onClose={vi.fn()} onSubmit={vi.fn()} />)
    expect(screen.getByPlaceholderText('Zone name…')).toBeDefined()
    expect(screen.getByText('Add Zone')).toBeDefined()
    expect(screen.getByText('Text Position')).toBeDefined()
    expect(screen.getByText('Border Width')).toBeDefined()
    expect(screen.getByText('Z-Order (1 = furthest back)')).toBeDefined()
  })

  it('renders Edit Zone title when provided', () => {
    render(<GroupRectModal open onClose={vi.fn()} onSubmit={vi.fn()} title="Edit Zone" />)
    expect(screen.getByText('Edit Zone')).toBeDefined()
  })

  it('calls onSubmit with form data on submit', () => {
    const onSubmit = vi.fn()
    render(<GroupRectModal open onClose={vi.fn()} onSubmit={onSubmit} />)
    const input = screen.getByPlaceholderText('Zone name…')
    fireEvent.change(input, { target: { value: 'DMZ' } })
    fireEvent.click(screen.getByText('Add'))
    expect(onSubmit).toHaveBeenCalledOnce()
    const submitted = onSubmit.mock.calls[0][0] as GroupRectFormData
    expect(submitted.label).toBe('DMZ')
    expect(submitted.font).toBe('inter')
    expect(submitted.z_order).toBe(1)
  })

  it('exposes aria-labels on grid buttons and select triggers', () => {
    render(<GroupRectModal open onClose={vi.fn()} onSubmit={vi.fn()} />)
    expect(screen.getByLabelText('Font selector')).toBeDefined()
    expect(screen.getByLabelText('Z-order selector')).toBeDefined()
    expect(screen.getByLabelText('Text position ↘')).toBeDefined()
    expect(screen.getByLabelText('Label position Inside')).toBeDefined()
    expect(screen.getByLabelText('Border style Solid')).toBeDefined()
    expect(screen.getByLabelText('Border width 1px')).toBeDefined()
  })

  it('calls onClose when Cancel is clicked', () => {
    const onClose = vi.fn()
    render(<GroupRectModal open onClose={onClose} onSubmit={vi.fn()} />)
    fireEvent.click(screen.getByText('Cancel'))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('shows Delete button when onDelete is provided', () => {
    const onDelete = vi.fn()
    render(<GroupRectModal open onClose={vi.fn()} onSubmit={vi.fn()} onDelete={onDelete} />)
    expect(screen.getByText('Delete')).toBeDefined()
  })

  it('calls onDelete and onClose when Delete is clicked', () => {
    const onDelete = vi.fn()
    const onClose = vi.fn()
    render(<GroupRectModal open onClose={onClose} onSubmit={vi.fn()} onDelete={onDelete} />)
    fireEvent.click(screen.getByText('Delete'))
    expect(onDelete).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('pre-fills form from initial prop', () => {
    render(
      <GroupRectModal
        open
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        initial={{ label: 'Pre-filled', z_order: 5, font: 'mono' }}
      />
    )
    const input = screen.getByPlaceholderText('Zone name…') as HTMLInputElement
    expect(input.value).toBe('Pre-filled')
  })

  it('selects text position button', () => {
    const onSubmit = vi.fn()
    render(<GroupRectModal open onClose={vi.fn()} onSubmit={onSubmit} />)
    // Click bottom-right (↘)
    fireEvent.click(screen.getByTitle('bottom-right'))
    fireEvent.click(screen.getByText('Add'))
    const submitted = onSubmit.mock.calls[0][0] as GroupRectFormData
    expect(submitted.text_position).toBe('bottom-right')
  })

  it('renders Border Style section', () => {
    render(<GroupRectModal open onClose={vi.fn()} onSubmit={vi.fn()} />)
    expect(screen.getByText('Border Style')).toBeDefined()
    expect(screen.getByTitle('Solid')).toBeDefined()
    expect(screen.getByTitle('Dashed')).toBeDefined()
    expect(screen.getByTitle('Dotted')).toBeDefined()
    expect(screen.getByTitle('Double')).toBeDefined()
    expect(screen.getByTitle('None')).toBeDefined()
  })

  it('defaults border_style to solid', () => {
    const onSubmit = vi.fn()
    render(<GroupRectModal open onClose={vi.fn()} onSubmit={onSubmit} />)
    fireEvent.click(screen.getByText('Add'))
    const submitted = onSubmit.mock.calls[0][0] as GroupRectFormData
    expect(submitted.border_style).toBe('solid')
  })

  it('selects border style on click', () => {
    const onSubmit = vi.fn()
    render(<GroupRectModal open onClose={vi.fn()} onSubmit={onSubmit} />)
    fireEvent.click(screen.getByTitle('Dashed'))
    fireEvent.click(screen.getByText('Add'))
    const submitted = onSubmit.mock.calls[0][0] as GroupRectFormData
    expect(submitted.border_style).toBe('dashed')
  })

  it('pre-fills border_style from initial prop', () => {
    const onSubmit = vi.fn()
    render(
      <GroupRectModal
        open
        onClose={vi.fn()}
        onSubmit={onSubmit}
        initial={{ border_style: 'dotted' }}
      />
    )
    fireEvent.click(screen.getByText('Add'))
    const submitted = onSubmit.mock.calls[0][0] as GroupRectFormData
    expect(submitted.border_style).toBe('dotted')
  })

  it('renders Label Position section with inside/outside options', () => {
    render(<GroupRectModal open onClose={vi.fn()} onSubmit={vi.fn()} />)
    expect(screen.getByText('Label Position')).toBeDefined()
    expect(screen.getByText('Inside')).toBeDefined()
    expect(screen.getByText('Outside')).toBeDefined()
  })

  it('defaults label_position to inside', () => {
    const onSubmit = vi.fn()
    render(<GroupRectModal open onClose={vi.fn()} onSubmit={onSubmit} />)
    fireEvent.click(screen.getByText('Add'))
    const submitted = onSubmit.mock.calls[0][0] as GroupRectFormData
    expect(submitted.label_position).toBe('inside')
  })

  it('selects outside label position on click', () => {
    const onSubmit = vi.fn()
    render(<GroupRectModal open onClose={vi.fn()} onSubmit={onSubmit} />)
    fireEvent.click(screen.getByText('Outside'))
    fireEvent.click(screen.getByText('Add'))
    const submitted = onSubmit.mock.calls[0][0] as GroupRectFormData
    expect(submitted.label_position).toBe('outside')
  })

  it('pre-fills label_position from initial prop', () => {
    const onSubmit = vi.fn()
    render(
      <GroupRectModal
        open
        onClose={vi.fn()}
        onSubmit={onSubmit}
        initial={{ label_position: 'outside' }}
      />
    )
    fireEvent.click(screen.getByText('Add'))
    const submitted = onSubmit.mock.calls[0][0] as GroupRectFormData
    expect(submitted.label_position).toBe('outside')
  })

  it('renders Text Size section with 6 options', () => {
    render(<GroupRectModal open onClose={vi.fn()} onSubmit={vi.fn()} />)
    expect(screen.getByText('Text Size')).toBeDefined()
    expect(screen.getByText('10')).toBeDefined()
    expect(screen.getByText('20')).toBeDefined()
  })

  it('defaults text_size to 12', () => {
    const onSubmit = vi.fn()
    render(<GroupRectModal open onClose={vi.fn()} onSubmit={onSubmit} />)
    fireEvent.click(screen.getByText('Add'))
    const submitted = onSubmit.mock.calls[0][0] as GroupRectFormData
    expect(submitted.text_size).toBe(12)
  })

  it('selects text size on click', () => {
    const onSubmit = vi.fn()
    render(<GroupRectModal open onClose={vi.fn()} onSubmit={onSubmit} />)
    fireEvent.click(screen.getByText('18'))
    fireEvent.click(screen.getByText('Add'))
    const submitted = onSubmit.mock.calls[0][0] as GroupRectFormData
    expect(submitted.text_size).toBe(18)
  })

  it('pre-fills text_size from initial prop', () => {
    const onSubmit = vi.fn()
    render(
      <GroupRectModal
        open
        onClose={vi.fn()}
        onSubmit={onSubmit}
        initial={{ text_size: 16 }}
      />
    )
    fireEvent.click(screen.getByText('Add'))
    const submitted = onSubmit.mock.calls[0][0] as GroupRectFormData
    expect(submitted.text_size).toBe(16)
  })

  it('renders Border Width section with 5 options', () => {
    render(<GroupRectModal open onClose={vi.fn()} onSubmit={vi.fn()} />)
    expect(screen.getByText('Border Width')).toBeDefined()
    expect(screen.getByText('1px')).toBeDefined()
    expect(screen.getByText('3px')).toBeDefined()
    expect(screen.getByText('5px')).toBeDefined()
  })

  it('defaults border_width to 2', () => {
    const onSubmit = vi.fn()
    render(<GroupRectModal open onClose={vi.fn()} onSubmit={onSubmit} />)
    fireEvent.click(screen.getByText('Add'))
    const submitted = onSubmit.mock.calls[0][0] as GroupRectFormData
    expect(submitted.border_width).toBe(2)
  })

  it('selects border width on click', () => {
    const onSubmit = vi.fn()
    render(<GroupRectModal open onClose={vi.fn()} onSubmit={onSubmit} />)
    fireEvent.click(screen.getByText('4px'))
    fireEvent.click(screen.getByText('Add'))
    const submitted = onSubmit.mock.calls[0][0] as GroupRectFormData
    expect(submitted.border_width).toBe(4)
  })

  it('pre-fills border_width from initial prop', () => {
    const onSubmit = vi.fn()
    render(
      <GroupRectModal
        open
        onClose={vi.fn()}
        onSubmit={onSubmit}
        initial={{ border_width: 5 }}
      />
    )
    fireEvent.click(screen.getByText('Add'))
    const submitted = onSubmit.mock.calls[0][0] as GroupRectFormData
    expect(submitted.border_width).toBe(5)
  })

  it('toggles border style — clicking selected style deselects back to solid', () => {
    const onSubmit = vi.fn()
    render(<GroupRectModal open onClose={vi.fn()} onSubmit={onSubmit} />)
    fireEvent.click(screen.getByTitle('Dotted'))
    fireEvent.click(screen.getByTitle('Solid'))
    fireEvent.click(screen.getByText('Add'))
    const submitted = onSubmit.mock.calls[0][0] as GroupRectFormData
    expect(submitted.border_style).toBe('solid')
  })

  it('shows opacity sliders for all three color fields', () => {
    render(<GroupRectModal open onClose={vi.fn()} onSubmit={vi.fn()} />)
    const sliders = screen.getAllByRole('slider')
    expect(sliders).toHaveLength(3)
  })

  it('default background_color is 8-digit hex with low alpha', () => {
    const onSubmit = vi.fn()
    render(<GroupRectModal open onClose={vi.fn()} onSubmit={onSubmit} />)
    fireEvent.click(screen.getByText('Add'))
    const submitted = onSubmit.mock.calls[0][0] as GroupRectFormData
    expect(submitted.background_color).toBe('#00d4ff0d')
    expect(submitted.background_color.length).toBe(9)
  })

  it('moving background opacity slider updates background_color alpha', () => {
    const onSubmit = vi.fn()
    render(<GroupRectModal open onClose={vi.fn()} onSubmit={onSubmit} />)
    // background slider is the third one (Text, Border, Background)
    const sliders = screen.getAllByRole('slider')
    fireEvent.change(sliders[2], { target: { value: '50' } })
    fireEvent.click(screen.getByText('Add'))
    const submitted = onSubmit.mock.calls[0][0] as GroupRectFormData
    // alpha 50% → 0x80 = 128
    expect(submitted.background_color).toBe('#00d4ff80')
  })

  it('moving border opacity slider to 0 makes border fully transparent', () => {
    const onSubmit = vi.fn()
    render(<GroupRectModal open onClose={vi.fn()} onSubmit={onSubmit} />)
    const sliders = screen.getAllByRole('slider')
    fireEvent.change(sliders[1], { target: { value: '0' } })
    fireEvent.click(screen.getByText('Add'))
    const submitted = onSubmit.mock.calls[0][0] as GroupRectFormData
    expect(submitted.border_color).toBe('#00d4ff00')
  })

  it('pre-fills opacity from 8-digit initial background_color', () => {
    render(
      <GroupRectModal
        open
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        initial={{ background_color: '#ff6e0080' }}
      />
    )
    const sliders = screen.getAllByRole('slider')
    expect((sliders[2] as HTMLInputElement).value).toBe('50')
  })

  it('shows opacity percentage in label', () => {
    render(<GroupRectModal open onClose={vi.fn()} onSubmit={vi.fn()} />)
    // Background default is 5% opacity
    expect(screen.getByText(/Background 5%/)).toBeInTheDocument()
  })
})

describe('GroupRectModal font label rendering', () => {
  it('renders the human font label in the Select trigger (default inter)', () => {
    render(<GroupRectModal open onClose={vi.fn()} onSubmit={vi.fn()} />)
    const trigger = screen.getByLabelText('Font selector')
    expect(trigger.textContent).toContain('Inter (sans-serif)')
  })

  it('falls back to raw value when font is unknown', () => {
    render(
      <GroupRectModal
        open
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        initial={{ font: 'comic-sans-9000' }}
      />
    )
    const trigger = screen.getByLabelText('Font selector')
    expect(trigger.textContent).toContain('comic-sans-9000')
  })
})

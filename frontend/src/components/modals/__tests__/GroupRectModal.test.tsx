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
})

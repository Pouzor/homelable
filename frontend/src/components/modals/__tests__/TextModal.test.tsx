import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TextModal, type TextFormData } from '../TextModal'

describe('TextModal', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <TextModal open={false} onClose={vi.fn()} onSubmit={vi.fn()} />
    )
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })

  it('renders form fields when open', () => {
    render(<TextModal open onClose={vi.fn()} onSubmit={vi.fn()} />)
    expect(screen.getByPlaceholderText('Type text…')).toBeDefined()
    expect(screen.getByText('Add Text')).toBeDefined()
    expect(screen.getByText('Police')).toBeDefined()
    expect(screen.getByText('Border Style')).toBeDefined()
    expect(screen.getByText('Size')).toBeDefined()
  })

  it('renders Edit Text title when provided', () => {
    render(<TextModal open onClose={vi.fn()} onSubmit={vi.fn()} title="Edit Text" />)
    expect(screen.getByText('Edit Text')).toBeDefined()
  })

  it('calls onSubmit with form data on submit', () => {
    const onSubmit = vi.fn()
    render(<TextModal open onClose={vi.fn()} onSubmit={onSubmit} />)
    const ta = screen.getByPlaceholderText('Type text…')
    fireEvent.change(ta, { target: { value: 'Hello' } })
    fireEvent.click(screen.getByText('Add'))
    expect(onSubmit).toHaveBeenCalledOnce()
    const submitted = onSubmit.mock.calls[0][0] as TextFormData
    expect(submitted.text).toBe('Hello')
    expect(submitted.font).toBe('inter')
    expect(submitted.border_style).toBe('none')
  })

  it('hides Border Width when style is none, shows when not', () => {
    render(<TextModal open onClose={vi.fn()} onSubmit={vi.fn()} />)
    expect(screen.queryByText('Border Width')).toBeNull()
    fireEvent.click(screen.getByTitle('Solid'))
    expect(screen.getByText('Border Width')).toBeDefined()
  })

  it('shows Delete button and calls handlers when provided', () => {
    const onDelete = vi.fn()
    const onClose = vi.fn()
    render(<TextModal open onClose={onClose} onSubmit={vi.fn()} onDelete={onDelete} />)
    fireEvent.click(screen.getByText('Delete'))
    expect(onDelete).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('pre-fills from initial prop', () => {
    render(
      <TextModal
        open
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        initial={{ text: 'Pre-filled', text_size: 24, font: 'mono' }}
      />
    )
    const ta = screen.getByPlaceholderText('Type text…') as HTMLTextAreaElement
    expect(ta.value).toBe('Pre-filled')
  })

  it('cancel calls onClose', () => {
    const onClose = vi.fn()
    render(<TextModal open onClose={onClose} onSubmit={vi.fn()} />)
    fireEvent.click(screen.getByText('Cancel'))
    expect(onClose).toHaveBeenCalledOnce()
  })
})

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DesignModal } from '../DesignModal'
import { DEFAULT_DESIGN_ICON } from '@/utils/designIcons'

function renderModal(props: Partial<Parameters<typeof DesignModal>[0]> = {}) {
  const onClose = vi.fn()
  const onSubmit = vi.fn()
  render(<DesignModal open onClose={onClose} onSubmit={onSubmit} {...props} />)
  return { onClose, onSubmit }
}

describe('DesignModal', () => {
  it('creates with the typed name and default icon', () => {
    const { onSubmit } = renderModal()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Home Network' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(onSubmit).toHaveBeenCalledWith({ name: 'Home Network', icon: DEFAULT_DESIGN_ICON })
  })

  it('submits the selected icon', () => {
    const { onSubmit } = renderModal()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Rack Power' } })
    fireEvent.click(screen.getByRole('button', { name: 'Electrical' })) // zap icon's aria-label
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(onSubmit).toHaveBeenCalledWith({ name: 'Rack Power', icon: 'zap' })
  })

  it('trims whitespace and blocks empty names', () => {
    const { onSubmit } = renderModal()
    // Empty → submit disabled, no call.
    const submit = screen.getByRole('button', { name: 'Create' })
    expect(submit).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '  Spaced  ' } })
    fireEvent.click(submit)
    expect(onSubmit).toHaveBeenCalledWith({ name: 'Spaced', icon: DEFAULT_DESIGN_ICON })
  })

  it('prefills name and icon in edit mode', () => {
    const { onSubmit } = renderModal({
      initial: { name: 'Existing', icon: 'server' },
      title: 'Edit Canvas',
      submitLabel: 'Save',
    })
    expect(screen.getByLabelText('Name')).toHaveValue('Existing')
    // The server icon button is pre-selected.
    expect(screen.getByRole('button', { name: 'Server' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSubmit).toHaveBeenCalledWith({ name: 'Existing', icon: 'server' })
  })

  it('submits on Enter from the name field', () => {
    const { onSubmit } = renderModal()
    const input = screen.getByLabelText('Name')
    fireEvent.change(input, { target: { value: 'Quick' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSubmit).toHaveBeenCalledWith({ name: 'Quick', icon: DEFAULT_DESIGN_ICON })
  })

  it('calls onClose from Cancel', () => {
    const { onClose, onSubmit } = renderModal()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalled()
    expect(onSubmit).not.toHaveBeenCalled()
  })
})

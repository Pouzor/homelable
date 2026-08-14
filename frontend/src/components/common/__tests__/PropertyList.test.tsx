/**
 * Shared property editor — used by the node DetailPanel and the rack cable
 * panel, so a positional bug here lands on both canvases.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PropertyList } from '../PropertyList'
import type { NodeProperty } from '@/types'

const props = (): NodeProperty[] => [
  { key: 'A', value: '1', icon: null, visible: true },
  { key: 'B', value: '2', icon: null, visible: true },
  { key: 'C', value: '3', icon: null, visible: true },
]

/** The form's confirm button; the section header carries an "Add" too. */
const confirm = (name: string) => {
  const buttons = screen.getAllByRole('button', { name })
  return buttons[buttons.length - 1]
}

describe('PropertyList', () => {
  it('renders each property with its key and value', () => {
    render(<PropertyList properties={props()} onChange={vi.fn()} />)
    expect(screen.getByTitle('A')).toBeInTheDocument()
    expect(screen.getByTitle('3')).toBeInTheDocument()
  })

  it('adds a property', () => {
    const onChange = vi.fn()
    render(<PropertyList properties={[]} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    fireEvent.change(screen.getByPlaceholderText(/^Label/), { target: { value: 'GPU' } })
    fireEvent.change(screen.getByPlaceholderText(/^Value/), { target: { value: 'RTX' } })
    fireEvent.click(confirm('Add'))

    expect(onChange).toHaveBeenCalledWith([
      { key: 'GPU', value: 'RTX', icon: null, visible: true },
    ])
  })

  it('adds a property with a label and no value', () => {
    const onChange = vi.fn()
    render(<PropertyList properties={[]} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    fireEvent.change(screen.getByPlaceholderText(/^Label/), { target: { value: 'GPU' } })
    fireEvent.click(confirm('Add'))

    expect(onChange).toHaveBeenCalledWith([{ key: 'GPU', value: '', icon: null, visible: true }])
  })

  it('refuses a property with no key', () => {
    const onChange = vi.fn()
    render(<PropertyList properties={[]} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    fireEvent.change(screen.getByPlaceholderText(/^Value/), { target: { value: 'RTX' } })
    fireEvent.click(confirm('Add'))

    expect(onChange).not.toHaveBeenCalled()
  })

  it('prints a value-less property as a bare label', () => {
    render(<PropertyList properties={[{ key: 'Rented', value: '', icon: null, visible: true }]} onChange={vi.fn()} />)

    expect(screen.getByTitle('Rented')).toBeInTheDocument()
    expect(screen.queryByText(/^·/)).not.toBeInTheDocument()
  })

  it('toggles a property between shown and hidden', () => {
    const onChange = vi.fn()
    render(<PropertyList properties={props()} onChange={onChange} />)

    fireEvent.click(screen.getAllByTitle('Hide on node')[1])
    expect(onChange.mock.calls[0][0][1].visible).toBe(false)
  })

  it('closes the open edit form when another property is removed', () => {
    // The form index is a position into an array the caller owns. Removing an
    // earlier row shifted the open form onto its neighbour, and Save then
    // overwrote the wrong property.
    const onChange = vi.fn()
    const { rerender } = render(<PropertyList properties={props()} onChange={onChange} />)

    fireEvent.click(screen.getAllByTitle('Edit property')[1]) // editing B
    expect(screen.getByDisplayValue('B')).toBeInTheDocument()

    fireEvent.click(screen.getAllByTitle('Remove property')[0]) // remove A
    const next = onChange.mock.calls[0][0]
    rerender(<PropertyList properties={next} onChange={onChange} />)

    // No form at all — index 1 now points at C, so a surviving form would sit
    // on the wrong property and Save would overwrite it.
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
    expect(next.map((p: NodeProperty) => p.key)).toEqual(['B', 'C'])
  })

  it('closes the open edit form when the list is reordered', () => {
    const onChange = vi.fn()
    const { rerender } = render(<PropertyList properties={props()} onChange={onChange} />)

    fireEvent.click(screen.getAllByTitle('Edit property')[2]) // editing C
    expect(screen.getByDisplayValue('C')).toBeInTheDocument()

    const rows = screen.getAllByTitle('Drag to reorder')
    fireEvent.dragStart(rows[0])
    fireEvent.dragEnter(rows[1])
    fireEvent.drop(rows[1])

    rerender(<PropertyList properties={onChange.mock.calls[0][0]} onChange={onChange} />)
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
  })

  it('saves an edit onto the property it was opened on', () => {
    const onChange = vi.fn()
    render(<PropertyList properties={props()} onChange={onChange} />)

    fireEvent.click(screen.getAllByTitle('Edit property')[1])
    fireEvent.change(screen.getByDisplayValue('2'), { target: { value: '22' } })
    fireEvent.click(confirm('Save'))

    expect(onChange.mock.calls[0][0]).toEqual([
      { key: 'A', value: '1', icon: null, visible: true },
      { key: 'B', value: '22', icon: null, visible: true },
      { key: 'C', value: '3', icon: null, visible: true },
    ])
  })

  it('saves an edit that clears the value', () => {
    const onChange = vi.fn()
    render(<PropertyList properties={props()} onChange={onChange} />)

    fireEvent.click(screen.getAllByTitle('Edit property')[1])
    fireEvent.change(screen.getByDisplayValue('2'), { target: { value: '' } })
    fireEvent.click(confirm('Save'))

    expect(onChange.mock.calls[0][0][1]).toEqual({ key: 'B', value: '', icon: null, visible: true })
  })

  it('words the visibility toggle for the surface it edits', () => {
    render(<PropertyList properties={props()} onChange={vi.fn()} visibleLabel="Show on canvas" />)
    expect(screen.getAllByTitle('Hide on canvas')).toHaveLength(3)
  })

  it('pre-fills the add form from a suggestion', () => {
    render(<PropertyList properties={[]} onChange={vi.fn()} suggestions={['Length']} />)
    fireEvent.click(screen.getByText('+ Length'))
    expect(screen.getByDisplayValue('Length')).toBeInTheDocument()
  })
})

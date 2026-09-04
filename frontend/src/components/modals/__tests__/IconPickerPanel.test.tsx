import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { IconPickerPanel } from '../IconPickerPanel'

describe('IconPickerPanel', () => {
  it('opens on the Generic tab by default', () => {
    render(<IconPickerPanel onSelect={vi.fn()} />)
    expect(screen.getByRole('tab', { name: 'Generic' }).getAttribute('aria-selected')).toBe('true')
  })

  it('opens on the Brand tab when the current value is a brand key', () => {
    render(<IconPickerPanel value="brand:plex" onSelect={vi.fn()} />)
    expect(screen.getByRole('tab', { name: 'Brand' }).getAttribute('aria-selected')).toBe('true')
  })

  it('emits the lucide key when a generic icon is picked', () => {
    const onSelect = vi.fn()
    render(<IconPickerPanel onSelect={onSelect} />)
    fireEvent.click(screen.getByLabelText('Select icon Database (SQL/NoSQL)'))
    expect(onSelect).toHaveBeenCalledWith('database')
  })

  it('emits undefined when the already-selected generic icon is clicked again', () => {
    const onSelect = vi.fn()
    render(<IconPickerPanel value="database" onSelect={onSelect} />)
    fireEvent.click(screen.getByLabelText('Select icon Database (SQL/NoSQL)'))
    expect(onSelect).toHaveBeenCalledWith(undefined)
  })

  it('filters the generic grid by search text', () => {
    render(<IconPickerPanel onSelect={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText('Search icons…'), { target: { value: 'grafana' } })
    expect(screen.getByLabelText('Select icon Grafana / Kibana')).toBeDefined()
    expect(screen.queryByLabelText('Select icon Database (SQL/NoSQL)')).toBeNull()
  })

  it('emits a prefixed key when a brand icon is picked', () => {
    const onSelect = vi.fn()
    render(<IconPickerPanel onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Brand' }))
    fireEvent.change(screen.getByLabelText('Brand icon search'), { target: { value: 'plex' } })
    fireEvent.click(screen.getByRole('button', { name: 'plex' }))
    expect(onSelect).toHaveBeenCalledWith('brand:plex')
  })

  it('offers the Homelable logo first in the Brand tab, served locally', () => {
    const onSelect = vi.fn()
    render(<IconPickerPanel onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Brand' }))
    const first = screen.getAllByRole('button')[0]
    expect(first.getAttribute('aria-label')).toBe('homelable')
    expect(first.querySelector('img')?.getAttribute('src')).toBe('/brand/homelable.svg')
    fireEvent.click(first)
    expect(onSelect).toHaveBeenCalledWith('brand:homelable')
  })

  it('keeps the generic search box out of the Brand tab', () => {
    render(<IconPickerPanel onSelect={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Brand' }))
    expect(screen.queryByPlaceholderText('Search icons…')).toBeNull()
  })
})

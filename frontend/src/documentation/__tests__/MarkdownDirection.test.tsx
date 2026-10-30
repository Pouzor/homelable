import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Markdown } from '../markdown/Markdown'

describe('Markdown — text direction', () => {
  it('renders a Hebrew paragraph right-to-left and an English one left-to-right', () => {
    render(<Markdown body={'שלום עולם\n\nHello world'} />)
    expect(screen.getByText('שלום עולם')).toHaveAttribute('dir', 'rtl')
    expect(screen.getByText('Hello world')).toHaveAttribute('dir', 'ltr')
  })

  it('sets the direction on the table itself, so its columns flip', () => {
    render(<Markdown body={'| שם | IP |\n| -- | -- |\n| שרת | 10.0.0.1 |'} />)
    expect(screen.getByRole('table')).toHaveAttribute('dir', 'rtl')
    expect(screen.getByRole('columnheader', { name: 'שם' })).toHaveAttribute('dir', 'rtl')
    expect(screen.getByRole('cell', { name: 'שרת' })).toHaveAttribute('dir', 'rtl')
  })

  it('sets the direction on lists and quotes, not only on their items', () => {
    const { container } = render(<Markdown body={'- פריט\n- עוד\n\n> ציטוט'} />)
    expect(screen.getByRole('list')).toHaveAttribute('dir', 'rtl')
    expect(container.querySelector('blockquote')).toHaveAttribute('dir', 'rtl')
  })

  it('directs headings at every level', () => {
    render(<Markdown body={'# כותרת\n\n#### Deep heading'} />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveAttribute('dir', 'rtl')
    expect(screen.getByRole('heading', { level: 4 })).toHaveAttribute('dir', 'ltr')
  })

  it('keeps code blocks left-to-right in an RTL document', () => {
    const { container } = render(<Markdown body={'שלום\n\n```\necho hi\n```'} />)
    expect(container.querySelector('pre')).not.toHaveAttribute('dir')
  })

  it('uses logical spacing so indents and borders follow the direction', () => {
    const { container } = render(<Markdown body={'- item\n\n> quote'} />)
    expect(screen.getByRole('list')).toHaveClass('ps-5')
    expect(container.querySelector('blockquote')).toHaveClass('border-s-2', 'ps-4')
  })
})

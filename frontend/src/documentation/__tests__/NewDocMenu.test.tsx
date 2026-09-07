/**
 * The template picker opens from a button at the right edge of a narrow,
 * scrolling, resizable column. It used to be absolutely positioned inside that
 * column, where it was clipped by the scroll container and painted under the
 * app sidebar; it is portalled to the body now, so what these pin is that it
 * leaves the column and stays inside the viewport.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import { NewDocMenu } from '../components/NewDocMenu'

function open(placement: 'up' | 'down' = 'down', onCreate = vi.fn()) {
  const view = render(
    <div style={{ overflow: 'auto', width: 260 }}>
      <NewDocMenu placement={placement} onCreate={onCreate} trigger={<button>New</button>} />
    </div>,
  )
  fireEvent.click(screen.getByText('New'))
  return { ...view, onCreate }
}

afterEach(() => vi.restoreAllMocks())

describe('NewDocMenu', () => {
  it('opens on the trigger and lists every template', () => {
    open()
    expect(screen.getByRole('menu')).toBeTruthy()
    expect(screen.getByText('Runbook')).toBeTruthy()
    expect(screen.getByText('Decision (ADR)')).toBeTruthy()
  })

  it('renders outside the scrolling column that would clip it', () => {
    const { container } = open()
    // Portalled: the menu is in the body, not under the component's own tree.
    expect(container.querySelector('[role="menu"]')).toBeNull()
    expect(document.body.querySelector('[role="menu"]')).toBeTruthy()
  })

  it('keeps its left edge inside the viewport', () => {
    open()
    const menu = screen.getByRole('menu') as HTMLElement
    // Tailwind's `fixed` is a class, and jsdom loads no stylesheet to resolve it.
    expect(menu.className).toContain('fixed')
    expect(parseFloat(menu.style.left)).toBeGreaterThanOrEqual(0)
  })

  it('hangs below the trigger when it opens downwards', () => {
    open('down')
    const menu = screen.getByRole('menu') as HTMLElement
    expect(menu.style.top).not.toBe('')
    expect(menu.style.bottom).toBe('')
  })

  it('sits above the trigger when it opens upwards', () => {
    open('up')
    const menu = screen.getByRole('menu') as HTMLElement
    expect(menu.style.bottom).not.toBe('')
    expect(menu.style.top).toBe('')
  })

  it('closes on Escape', () => {
    open()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('closes on a click outside itself', () => {
    open()
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('stays open while the click is inside it', () => {
    open()
    fireEvent.mouseDown(screen.getByText('Runbook'))
    expect(screen.queryByRole('menu')).toBeTruthy()
  })

  it('closes rather than floating away when the page scrolls', () => {
    open()
    fireEvent.scroll(document, {})
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('creates from the picked template with the typed title', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue('  Switch upgrade  ')
    const { onCreate } = open()

    fireEvent.click(screen.getByText('Runbook'))

    expect(onCreate).toHaveBeenCalledWith({
      title: 'Switch upgrade',
      templateId: 'runbook',
      parentId: undefined,
    })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('creates nothing when the title is cancelled or blank', () => {
    vi.spyOn(window, 'prompt').mockReturnValue('   ')
    const { onCreate } = open()

    fireEvent.click(screen.getByText('Blank page'))

    expect(onCreate).not.toHaveBeenCalled()
  })
})

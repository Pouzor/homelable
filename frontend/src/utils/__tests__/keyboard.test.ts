import { describe, it, expect, afterEach } from 'vitest'
import { isTypingTarget } from '../keyboard'

// Dispatches a keydown from `el` and returns what a window-level shortcut
// handler would conclude about it.
function typingFrom(el: Element): boolean {
  let result = false
  const handler = (e: KeyboardEvent) => { result = isTypingTarget(e) }
  window.addEventListener('keydown', handler)
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true, composed: true }))
  window.removeEventListener('keydown', handler)
  return result
}

function mount<K extends keyof HTMLElementTagNameMap>(tag: K, parent: Node = document.body) {
  const el = document.createElement(tag)
  parent.appendChild(el)
  return el
}

describe('isTypingTarget', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it.each(['input', 'textarea', 'select'] as const)('is true for a <%s>', (tag) => {
    expect(typingFrom(mount(tag))).toBe(true)
  })

  it('is true for a contentEditable element', () => {
    const el = mount('div')
    // jsdom does not implement isContentEditable
    Object.defineProperty(el, 'isContentEditable', { value: true })
    expect(typingFrom(el)).toBe(true)
  })

  it('is false for a non-field element', () => {
    expect(typingFrom(mount('div'))).toBe(false)
    expect(typingFrom(mount('button'))).toBe(false)
  })

  it('is false when the event is dispatched on window itself', () => {
    let result = true
    const handler = (e: KeyboardEvent) => { result = isTypingTarget(e) }
    window.addEventListener('keydown', handler)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's' }))
    window.removeEventListener('keydown', handler)
    expect(result).toBe(false)
  })

  // Regression for #546: inside a shadow root (the Home Assistant panel) the
  // window listener sees `target` retargeted to the host, not the input.
  it('is true for an input inside a shadow root', () => {
    const host = mount('div')
    const shadow = host.attachShadow({ mode: 'open' })
    const input = mount('input', shadow)

    let seenTarget: EventTarget | null = null
    const spy = (e: KeyboardEvent) => { seenTarget = e.target }
    window.addEventListener('keydown', spy)
    const result = typingFrom(input)
    window.removeEventListener('keydown', spy)

    expect(seenTarget).toBe(host)
    expect(result).toBe(true)
  })

  it('is false for a non-field element inside a shadow root', () => {
    const shadow = mount('div').attachShadow({ mode: 'open' })
    expect(typingFrom(mount('div', shadow))).toBe(false)
  })
})

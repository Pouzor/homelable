const TYPING_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

/**
 * True when a key event comes from a field the user is typing in, so a global
 * shortcut must leave the key alone.
 *
 * Reads `composedPath()[0]` rather than `target`: a listener on `window` sees
 * `target` retargeted to the shadow host when the app is mounted in a shadow
 * root (the Home Assistant panel), which made every `tagName` guard miss.
 */
export function isTypingTarget(e: KeyboardEvent): boolean {
  const el = (e.composedPath()[0] ?? e.target) as HTMLElement | null
  if (!el || typeof el.tagName !== 'string') return false
  return TYPING_TAGS.has(el.tagName) || el.isContentEditable === true
}

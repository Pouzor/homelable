/**
 * Where the caret is, in pixels, inside a `<textarea>` — and where a popup
 * anchored to it should go.
 *
 * A textarea exposes no caret geometry, so the only way to measure it is the
 * mirror trick: build a hidden div carrying the same text metrics and box, fill
 * it with the text up to the caret, and read back the position of a marker span
 * at the end of it.
 *
 * The placement maths is kept separate from the measuring so it can be tested:
 * jsdom lays nothing out, so every `offsetTop` there is 0 and a test of the
 * measurement itself would assert nothing.
 */

/** Point relative to the textarea's padding box, before scroll is applied. */
export interface CaretPoint {
  top: number
  left: number
  /** Height of one line, so a popup can clear the caret rather than cover it. */
  lineHeight: number
}

/** Every property that changes where text lands, copied onto the mirror. */
const MIRRORED = [
  'boxSizing',
  'width',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'letterSpacing',
  'lineHeight',
  'textTransform',
  'textIndent',
  'whiteSpace',
  'wordSpacing',
  'wordBreak',
  'tabSize',
] as const

/**
 * Measure the caret at `index`, relative to the textarea's own box.
 *
 * The textarea's scroll offset is subtracted, so the result is where the caret
 * appears on screen rather than where it sits in the full text.
 */
export function caretPoint(el: HTMLTextAreaElement, index: number): CaretPoint {
  const style = window.getComputedStyle(el)
  const mirror = document.createElement('div')

  for (const property of MIRRORED) {
    mirror.style[property] = style[property]
  }
  // A textarea wraps and preserves its whitespace; a div does neither by default.
  mirror.style.whiteSpace = 'pre-wrap'
  mirror.style.overflowWrap = 'break-word'
  mirror.style.position = 'absolute'
  mirror.style.visibility = 'hidden'
  mirror.style.top = '0'
  mirror.style.left = '-9999px'
  mirror.style.height = 'auto'

  mirror.textContent = el.value.slice(0, index)
  const marker = document.createElement('span')
  // A zero-width space keeps the span from collapsing on an empty last line,
  // which would put the marker on the previous one.
  marker.textContent = '​'
  mirror.appendChild(marker)

  document.body.appendChild(mirror)
  const top = marker.offsetTop - el.scrollTop
  const left = marker.offsetLeft - el.scrollLeft
  document.body.removeChild(mirror)

  const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4 || 16

  return { top, left, lineHeight }
}

export interface Box {
  width: number
  height: number
}

export interface PlacementInput {
  caret: CaretPoint
  /** The positioned ancestor the popup is absolutely placed inside. */
  pane: Box
  menu: Box
  /** Space between the caret line and the popup. */
  gap?: number
}

export interface Placement {
  top: number
  left: number
  /** True when there was no room below and the popup sits above the caret. */
  flipped: boolean
}

/**
 * Place a popup under the caret, kept inside the pane.
 *
 * Below the caret by default. When the popup would run past the bottom it goes
 * above instead — and if it fits in neither direction (a short pane, a long
 * list) it takes whichever side has more room and is clamped there, so it is
 * never pushed off-screen the way a fixed `bottom-4` anchor was.
 */
export function placeMenu({ caret, pane, menu, gap = 4 }: PlacementInput): Placement {
  const below = caret.top + caret.lineHeight + gap
  const above = caret.top - gap - menu.height

  const roomBelow = pane.height - below
  const roomAbove = caret.top - gap

  let top: number
  let flipped: boolean
  if (menu.height <= roomBelow) {
    top = below
    flipped = false
  } else if (menu.height <= roomAbove) {
    top = above
    flipped = true
  } else {
    // Neither side fits: take the roomier one and clamp into the pane.
    flipped = roomAbove > roomBelow
    top = flipped ? above : below
  }
  top = Math.max(0, Math.min(top, Math.max(0, pane.height - menu.height)))

  const left = Math.max(0, Math.min(caret.left, Math.max(0, pane.width - menu.width)))

  return { top, left, flipped }
}

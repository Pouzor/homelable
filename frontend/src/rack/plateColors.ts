/**
 * Colour rules for a faceplate's label.
 *
 * A plate's fill is user-chosen, the label colour comes from the theme, and the
 * two know nothing about each other: a white patch panel on a dark theme printed
 * near-white text on near-white metal. Unless the user picks a label colour, the
 * theme's own is kept when it reads on the fill and swapped for dark or light ink
 * when it does not.
 */

/** Ink used when the theme's label colour does not read on the plate. */
export const DARK_INK = '#0d1117'
export const LIGHT_INK = '#f0f6fc'

/**
 * WCAG's floor for large or bold text. Plate labels are small but short, and a
 * stricter bar would overrule tinted theme text (matrix green, neon) that still
 * reads fine on the default plates.
 */
const MIN_CONTRAST = 3

function parseHex(color: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim())
  if (!m) return null
  const hex = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1]
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]
}

/** WCAG relative luminance, or null for a colour this cannot read. */
export function luminance(color: string): number | null {
  const rgb = parseHex(color)
  if (!rgb) return null
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio between two colours, or null when either is unreadable. */
export function contrast(a: string, b: string): number | null {
  const la = luminance(a)
  const lb = luminance(b)
  if (la === null || lb === null) return null
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * The label colour for a plate: the user's pick, else the theme's when it reads
 * on `fill`, else whichever ink reads better. A colour this cannot parse (a
 * custom theme's `rgb()`, say) leaves the theme in charge rather than guessing.
 */
export function plateTextColor(fill: string, themeText: string, override?: string | null): string {
  if (override) return override
  const current = contrast(fill, themeText)
  if (current === null || current >= MIN_CONTRAST) return themeText
  return (contrast(fill, DARK_INK) ?? 0) >= (contrast(fill, LIGHT_INK) ?? 0) ? DARK_INK : LIGHT_INK
}

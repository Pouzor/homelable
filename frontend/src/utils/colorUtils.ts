/**
 * Split a 6- or 8-digit hex color into its RGB hex and alpha (0–100).
 * 6-digit input returns alpha 100.
 * Invalid input returns { hex6: '#000000', alpha: 100 }.
 */
export function hexToRgba(hex: string): { hex6: string; alpha: number } {
  const clean = hex.replace('#', '')
  if (clean.length === 8) {
    const alphaByte = parseInt(clean.slice(6, 8), 16)
    return {
      hex6: `#${clean.slice(0, 6)}`,
      alpha: Math.round((alphaByte / 255) * 100),
    }
  }
  if (clean.length === 6) {
    return { hex6: `#${clean}`, alpha: 100 }
  }
  return { hex6: '#000000', alpha: 100 }
}

/**
 * Combine a 6-digit hex color and an alpha (0–100) into an 8-digit hex.
 */
export function rgbaToHex8(hex6: string, alpha: number): string {
  const clamped = Math.max(0, Math.min(100, alpha))
  const alphaByte = Math.round((clamped / 100) * 255)
  const alphaHex = alphaByte.toString(16).padStart(2, '0')
  return `${hex6}${alphaHex}`
}

/**
 * Combine a hex color and opacity (0–1) into a CSS rgba() string.
 * Returns the plain hex when opacity is 1.
 */
export function applyOpacity(hex: string, opacity: number): string {
  if (opacity >= 1) return hex
  let h = hex.replace('#', '')
  if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2]
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${Math.round(opacity * 100) / 100})`
}

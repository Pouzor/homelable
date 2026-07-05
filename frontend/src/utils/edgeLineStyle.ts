import type { EdgeLineStyle, EdgeType } from '@/types'

/** Line render styles selectable per edge type, in picker order. */
export const EDGE_LINE_STYLES: EdgeLineStyle[] = ['solid', 'dashed', 'dotted']

export const EDGE_LINE_STYLE_LABELS: Record<EdgeLineStyle, string> = {
  solid: 'Solid',
  dashed: 'Dashed',
  dotted: 'Dotted',
}

/**
 * Base stroke width (px) per edge type — the "1×" reference the width
 * multiplier scales from. Mirrors BASE_STYLES in canvas/edges/index.tsx.
 */
export const EDGE_TYPE_BASE_WIDTH: Record<EdgeType, number> = {
  ethernet: 2,
  wifi: 1.5,
  iot: 1.5,
  vlan: 2.5,
  virtual: 1,
  cluster: 2.5,
  fibre: 2.5,
  electrical: 2,
}

/** Default line render style per edge type (matches the hardcoded dash presets). */
export const EDGE_TYPE_DEFAULT_LINE: Record<EdgeType, EdgeLineStyle> = {
  ethernet: 'solid',
  wifi: 'dashed',
  iot: 'dotted',
  vlan: 'solid',
  virtual: 'dashed',
  cluster: 'dashed',
  fibre: 'solid',
  electrical: 'solid',
}

/** Multiplier is limited to 1×–4× of the type's base width. */
export function clampWidthMult(v: number | undefined): number {
  if (v == null || Number.isNaN(v)) return 1
  return Math.min(4, Math.max(1, v))
}

/**
 * SVG `stroke-dasharray` for a line style, scaled to the stroke width.
 * `solid` returns undefined (no dashes). `dotted` pairs with a round line cap
 * so the short segments render as dots.
 */
export function dashArrayFor(style: EdgeLineStyle, strokeWidth: number): string | undefined {
  const w = Math.max(0.5, strokeWidth)
  if (style === 'dashed') return `${w * 3} ${w * 2}`
  if (style === 'dotted') return `${w} ${w * 1.8}`
  return undefined
}

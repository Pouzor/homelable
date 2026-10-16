export type EdgeAnimMode = 'basic' | 'snake' | 'flow'

/** Seconds per cycle at 1× speed — the durations the renderer always used. */
export const EDGE_ANIM_BASE_DURATION: Record<EdgeAnimMode, number> = {
  basic: 0.5,
  snake: 10,
  flow: 1.2,
}

export const MIN_ANIM_SPEED = 0.25
export const MAX_ANIM_SPEED = 4

/**
 * Speed multiplier, limited to 0.25×–4×. A multiplier rather than seconds
 * because the base durations differ 20× between modes, so one value means
 * the same thing whichever mode an edge runs. Unset or invalid → 1×.
 */
export function clampAnimSpeed(v: number | undefined): number {
  if (v == null || !Number.isFinite(v) || v <= 0) return 1
  return Math.min(MAX_ANIM_SPEED, Math.max(MIN_ANIM_SPEED, v))
}

/** CSS duration for a mode at a given speed (2× speed = half the cycle). */
export function animDuration(mode: EdgeAnimMode, speed: number | undefined): string {
  return `${+(EDGE_ANIM_BASE_DURATION[mode] / clampAnimSpeed(speed)).toFixed(3)}s`
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i

/**
 * The animation highlight colour, or undefined to follow the line colour.
 * Only a `#rrggbb` hex is accepted: custom_style comes back from the server
 * as free JSON and lands straight in an SVG `stroke`.
 */
export function resolveAnimColor(v: string | undefined): string | undefined {
  return v && HEX_COLOR.test(v) ? v : undefined
}

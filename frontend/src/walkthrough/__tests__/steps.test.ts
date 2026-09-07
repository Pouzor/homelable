import { describe, it, expect } from 'vitest'
import { getSteps, STEPS } from '../steps'

describe('getSteps', () => {
  it('returns every step in full mode', () => {
    expect(getSteps(false)).toHaveLength(STEPS.length)
  })

  it('drops backend-only (mode:full) steps in standalone', () => {
    const standalone = getSteps(true)
    expect(standalone.every((s) => s.mode !== 'full')).toBe(true)
    expect(standalone.length).toBeLessThan(STEPS.length)
    const ids = standalone.map((s) => s.id)
    // Canvas-only steps survive; backend-only steps are filtered out.
    expect(ids).toEqual(expect.arrayContaining(['welcome', 'nodes', 'grouping', 'rack', 'style', 'end']))
    expect(ids).not.toContain('scan')
    expect(ids).not.toContain('scan-history')
    expect(ids).not.toContain('inventory')
    expect(ids).not.toContain('imports')
    // Documentation has nowhere to store a document without the backend.
    expect(ids).not.toContain('docs')
    expect(ids).not.toContain('docs-write')
    expect(ids).not.toContain('docs-devices')
  })

  it('walks the Documentation section on anchors the view carries', () => {
    const docs = STEPS.filter((s) => s.id.startsWith('docs'))
    expect(docs.map((s) => s.id)).toEqual(['docs', 'docs-write', 'docs-devices'])
    expect(docs.map((s) => s.anchor)).toEqual([
      '[data-tour="documentation"]',
      '[data-tour="docs-new"]',
      '[data-tour="docs-devices"]',
    ])
    // Every one of them needs the section open: `closeAll` puts the view back
    // to the canvas before each step, so the action cannot be dropped from the
    // second and third.
    expect(docs.every((s) => s.action === 'openDocumentation')).toBe(true)
    expect(docs.every((s) => s.mode === 'full')).toBe(true)
  })

  it('documents the homelab once it has been mapped, before the styling step', () => {
    const ids = STEPS.map((s) => s.id)
    expect(ids.indexOf('docs')).toBeGreaterThan(ids.indexOf('rack'))
    expect(ids.indexOf('docs-devices')).toBeLessThan(ids.indexOf('style'))
  })

  it('keeps the rack step in both modes — a rack canvas needs no backend', () => {
    const rack = STEPS.find((s) => s.id === 'rack')
    expect(rack?.mode).toBe('all')
    expect(rack?.anchor).toBe('[data-tour="canvas-switcher"]')
    expect(getSteps(true).map((s) => s.id)).toContain('rack')
  })

  it('introduces the rack canvas before the styling step', () => {
    const ids = STEPS.map((s) => s.id)
    expect(ids.indexOf('rack')).toBeGreaterThan(ids.indexOf('nodes'))
    expect(ids.indexOf('rack')).toBeLessThan(ids.indexOf('style'))
  })

  it('ends on a step with a GitHub link (the full-mode recap in standalone)', () => {
    const last = getSteps(true).at(-1)
    expect(last?.id).toBe('end')
    expect(last?.link?.href).toContain('github.com')
  })
})

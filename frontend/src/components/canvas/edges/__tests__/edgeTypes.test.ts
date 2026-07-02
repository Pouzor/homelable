import { describe, it, expect } from 'vitest'
import { edgeTypes } from '../edgeTypes'
import { EDGE_TYPE_LABELS, type EdgeType } from '@/types'

describe('edgeTypes registry', () => {
  // Regression (issue #21): an EdgeType missing here makes React Flow fall back
  // to its built-in default edge — grey, unstyled, ignoring custom_color.
  it('registers a component for every EdgeType', () => {
    for (const type of Object.keys(EDGE_TYPE_LABELS) as EdgeType[]) {
      expect(edgeTypes[type as keyof typeof edgeTypes]).toBeDefined()
    }
  })

  it('registers fibre', () => {
    expect(edgeTypes.fibre).toBeDefined()
  })
})

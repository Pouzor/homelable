import { describe, it, expect } from 'vitest'
import { exportCanvasToBase64, importCanvasFromBase64 } from '../exportCanvas'
import type { Node, Edge } from '@xyflow/react'
import type { NodeData, EdgeData } from '@/types'

const makeNode = (overrides: Partial<NodeData> = {}, id = '1', parentId?: string): Node<NodeData> => ({
  id,
  type: overrides.type ?? 'server',
  position: { x: 0, y: 0 },
  parentId,
  data: { label: 'Test', type: 'server', status: 'online', services: [], ...overrides },
})

const makeEdge = (id: string, source: string, target: string, data: Partial<EdgeData> = {}): Edge<EdgeData> => ({
  id,
  source,
  target,
  data: { type: 'ethernet', ...data } as EdgeData,
})

describe('exportCanvas Base64 utils', () => {
  it('serializes and deserializes a complete payload deterministically', () => {
    const nodes = [
      makeNode({ label: 'Server A', type: 'server', ip: '10.0.0.1', hostname: 'a.local' }, 'a'),
      makeNode({ label: 'Switch', type: 'switch' }, 'sw'),
    ]
    const edges = [makeEdge('e1', 'sw', 'a', { type: 'ethernet', label: 'eth0' })]

    const payload = {
      schema_version: 1,
      canvas: {
        nodes,
        edges,
        meta: { label: 'Test Canvas', created_at: '2026-04-24T00:00:00Z' },
      },
    }

    const b64 = exportCanvasToBase64(payload)
    const parsed = importCanvasFromBase64<typeof payload>(b64)
    expect(parsed).toEqual(payload)
  })

  it('supports Unicode characters (accents and emoji) through roundtrip', () => {
    const nodes = [
      makeNode({ label: 'Servidor São Paulo ☀️', type: 'server', notes: 'Descrição com acentos: ação, coração 🚀' }, 'n1'),
    ]
    const payload = { schema_version: 1, canvas: { nodes, edges: [], meta: { label: 'Café e emoji ☕️🚀' } } }

    const b64 = exportCanvasToBase64(payload)
    const parsed = importCanvasFromBase64<typeof payload>(b64)
    expect(parsed).toEqual(payload)
  })

  it('throws when importing invalid Base64 string', () => {
    const invalid = 'not-a-valid-base64!!@@'
    expect(() => importCanvasFromBase64(invalid)).toThrow()
  })
})

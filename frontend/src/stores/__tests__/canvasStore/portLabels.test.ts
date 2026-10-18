import { describe, it, expect, beforeEach } from 'vitest'
import { useCanvasStore } from '@/stores/canvasStore'
import { makeNode } from '@/test/factories'

function resetStore() {
  useCanvasStore.setState({
    nodes: [],
    edges: [],
    hasUnsavedChanges: false,
    editSeq: 0,
    selectedNodeId: null,
    selectedNodeIds: [],
    editingGroupRectId: null,
    editingTextId: null,
    past: [],
    future: [],
    clipboard: { nodes: [], edges: [] },
    serviceStatuses: {},
    floorMap: null,
  })
}

const labelsOf = (id: string) => useCanvasStore.getState().nodes.find((n) => n.id === id)!.data.port_labels

describe('canvasStore — port labels (#495)', () => {
  beforeEach(resetStore)

  it('stores labels sent through updateNode', () => {
    useCanvasStore.setState({ nodes: [makeNode('sw', { bottom_handles: 8 })] })
    useCanvasStore.getState().updateNode('sw', { port_labels: { top: '8', 'bottom-2': '2' } })
    expect(labelsOf('sw')).toEqual({ top: '8', 'bottom-2': '2' })
  })

  it('drops the labels of points a shrink removes, so a later grow starts blank', () => {
    useCanvasStore.setState({
      nodes: [makeNode('sw', { bottom_handles: 4, port_labels: { top: '8', 'bottom-3': '3', 'bottom-4': '4' } })],
    })
    useCanvasStore.getState().updateNode('sw', { bottom_handles: 2 })
    expect(labelsOf('sw')).toEqual({ top: '8' })
    useCanvasStore.getState().updateNode('sw', { bottom_handles: 4 })
    expect(labelsOf('sw')).toEqual({ top: '8' })
  })

  it('clears the field when the last label goes', () => {
    useCanvasStore.setState({ nodes: [makeNode('sw', { port_labels: { top: '8' } })] })
    useCanvasStore.getState().updateNode('sw', { top_handles: 0 })
    expect(labelsOf('sw')).toBeUndefined()
  })

  it('leaves an unlabelled node untouched', () => {
    useCanvasStore.setState({ nodes: [makeNode('sw', { bottom_handles: 4 })] })
    useCanvasStore.getState().updateNode('sw', { bottom_handles: 2 })
    expect(labelsOf('sw')).toBeUndefined()
  })
})

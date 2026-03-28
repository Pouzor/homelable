/**
 * LiveView — read-only canvas accessible at /view?key=<LIVEVIEW_KEY>.
 *
 * - Non-standalone: fetches canvas from /api/v1/liveview?key=... (no JWT needed).
 *   Returns 403 when the feature is disabled or the key is wrong.
 * - Standalone: loads canvas from localStorage directly (no key required,
 *   since there is no backend to validate against).
 *
 * Pan and zoom work. Editing is fully disabled.
 * Clicking a node with an IP opens http://<ip> in a new tab.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  ReactFlowProvider,
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  ConnectionMode,
  type Node,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useCanvasStore } from '@/stores/canvasStore'
import { useThemeStore } from '@/stores/themeStore'
import { THEMES } from '@/utils/themes'
import { nodeTypes } from '@/components/canvas/nodes/nodeTypes'
import { edgeTypes } from '@/components/canvas/edges/edgeTypes'
import { deserializeApiNode, deserializeApiEdge, type ApiNode, type ApiEdge } from '@/utils/canvasSerializer'
import { liveviewApi } from '@/api/client'
import type { NodeData } from '@/types'

const STANDALONE = import.meta.env.VITE_STANDALONE === 'true'
const STORAGE_KEY = 'homelable_canvas'

type ViewState = 'loading' | 'disabled' | 'invalid-key' | 'no-key' | 'ready'

function LiveViewCanvas() {
  const { nodes, edges, loadCanvas } = useCanvasStore()
  const activeTheme = useThemeStore((s) => s.activeTheme)
  const theme = THEMES[activeTheme]
  // Derive initial view state synchronously (avoids calling setState inside an effect):
  // - standalone → always ready (localStorage, no key required)
  // - non-standalone, no ?key= → no-key error immediately
  // - non-standalone, key present → loading (API call below)
  const [viewState, setViewState] = useState<ViewState>(() => {
    if (STANDALONE) return 'ready'
    return new URLSearchParams(window.location.search).get('key') ? 'loading' : 'no-key'
  })

  useEffect(() => {
    if (STANDALONE) {
      try {
        const saved = localStorage.getItem(STORAGE_KEY)
        if (saved) {
          const { nodes: savedNodes, edges: savedEdges } = JSON.parse(saved)
          loadCanvas(savedNodes, savedEdges)
        }
      } catch {
        // empty canvas on parse error — show empty canvas
      }
      return
    }

    // Already handled synchronously in useState initializer
    const key = new URLSearchParams(window.location.search).get('key')
    if (!key) return

    liveviewApi.load(key)
      .then((res) => {
        const { nodes: apiNodes, edges: apiEdges } = res.data
        const proxmoxMap = new Map<string, boolean>(
          (apiNodes as ApiNode[])
            .filter((n: ApiNode) => n.type === 'proxmox')
            .map((n: ApiNode) => [n.id, n.container_mode !== false])
        )
        loadCanvas(
          (apiNodes as ApiNode[]).map((n) => deserializeApiNode(n, proxmoxMap)),
          (apiEdges as ApiEdge[]).map(deserializeApiEdge),
        )
        setViewState('ready')
      })
      .catch((err) => {
        const detail: string = err.response?.data?.detail ?? ''
        setViewState(detail === 'Live view is disabled' ? 'disabled' : 'invalid-key')
      })
  }, [loadCanvas])

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node<NodeData>) => {
    const ip = node.data.ip
    if (ip) window.open(`http://${ip}`, '_blank', 'noopener,noreferrer')
  }, [])

  if (viewState === 'loading') {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#0d1117] text-[#8b949e]">
        Loading…
      </div>
    )
  }

  if (viewState !== 'ready') {
    const messages: Record<Exclude<ViewState, 'loading' | 'ready'>, string> = {
      disabled: 'Live view is disabled on this instance.',
      'invalid-key': 'Invalid or expired live view key.',
      'no-key': 'Missing key — use ?key=your-secret in the URL.',
    }
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#0d1117]">
        <div className="text-center space-y-2">
          <p className="text-[#f85149] text-lg font-medium">Access Denied</p>
          <p className="text-[#8b949e] text-sm">{messages[viewState]}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full h-screen" style={{ background: theme.colors.canvasBackground }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag
        zoomOnScroll
        fitView
        colorMode={theme.colors.reactFlowColorMode}
        connectionMode={ConnectionMode.Loose}
        onNodeClick={onNodeClick}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={24}
          size={1}
          color={theme.colors.canvasDotColor}
        />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  )
}

export default function LiveView() {
  return (
    <ReactFlowProvider>
      <LiveViewCanvas />
    </ReactFlowProvider>
  )
}

import React, { useState } from 'react'
import { Handle, Position, NodeResizer, type NodeProps, type Node } from '@xyflow/react'
import { Layers, RefreshCw } from 'lucide-react'
import type { NodeData } from '@/types'
import { resolveNodeColors } from '@/utils/nodeColors'
import { useThemeStore } from '@/stores/themeStore'
import { THEMES } from '@/utils/themes'
import { BaseNode } from './BaseNode'
import { useCanvasStore } from '@/stores/canvasStore'
import { api } from '@/api/client' 
import { toast } from 'sonner'

export function ProxmoxGroupNode(props: NodeProps<Node<NodeData>>) {
  const { id, data, selected } = props

  const activeTheme = useThemeStore((s) => s.activeTheme)
  const theme = THEMES[activeTheme]
  const colors = resolveNodeColors(data, activeTheme)

  const [isSyncing, setIsSyncing] = useState(false)
  const addNode = useCanvasStore((state) => state.addNode)
  const nodes = useCanvasStore((state) => state.nodes)

  const handleSync = async (e: React.MouseEvent) => {
    e.stopPropagation()
    setIsSyncing(true)
    
    try {
      const response = await api.get(`/proxmox/${id}/discover`)
      const resources = response.data.resources

      let addedCount = 0
      resources.forEach((res: any, index: number) => {
        
        const exists = nodes.some(n => 
          n.data.properties?.some((p: any) => 
            (p.key === 'vmid' || p.name === 'vmid') && String(p.value) === String(res.vmid)
          )
        )
        
        if (!exists) {
          // CORREÇÃO 3: Estrutura correta de um Node do React Flow
          addNode({
            id: crypto.randomUUID(),
            type: res.type === 'qemu' ? 'vm' : 'lxc',
            position: { x: 20, y: 60 + (index * 60) },
            parentId: id,
            data: {
              label: res.name,
              type: res.type === 'qemu' ? 'vm' : 'lxc',
              status: res.status === 'running' ? 'online' : 'offline',
              container_mode: false,
              properties: [
                { key: 'vmid', value: String(res.vmid) },
                { key: 'cpu', value: String(res.cpu_usage || 0) },
                { key: 'memory', value: String(res.mem_usage || 0) }
              ]
            }
          } as Node<NodeData>)
          addedCount++
        }
      })

      toast.success(`Sync complete: ${addedCount} new resources found.`)
    } catch (error) {
      console.error('Proxmox Sync Error:', error)
      toast.error('Failed to sync Proxmox resources.')
    } finally {
      setIsSyncing(false)
    }
  }

  // Render as a regular node when container mode is disabled
  if (data.container_mode === false) {
    const proxmoxAccent = theme.colors.nodeAccents.proxmox.border
    return (
      <>
        <BaseNode {...props} icon={Layers} />
        <Handle
          type="source"
          position={Position.Left}
          id="cluster-left"
          title="Same cluster"
          style={{ background: proxmoxAccent, borderColor: `${proxmoxAccent}88`, width: 6, height: 6 }}
        />
        <Handle
          type="source"
          position={Position.Right}
          id="cluster-right"
          title="Same cluster"
          style={{ background: proxmoxAccent, borderColor: `${proxmoxAccent}88`, width: 6, height: 6 }}
        />
      </>
    )
  }

  const statusColor = theme.colors.statusColors[data.status]
  const isOnline = data.status === 'online'
  const glow = colors.border
  const proxmoxAccent = theme.colors.nodeAccents.proxmox.border

  return (
    <>
      <NodeResizer
        minWidth={220}
        minHeight={160}
        isVisible={selected}
        lineStyle={{ borderColor: glow, opacity: 0.6 }}
        handleStyle={{ borderColor: glow, backgroundColor: theme.colors.nodeCardBackground }}
      />

      {/* Group border */}
      <div
        className="w-full h-full rounded-xl border-2 flex flex-col overflow-hidden"
        style={{
          borderColor: selected ? glow : `${glow}88`,
          background: isOnline ? `${colors.background}cc` : `${colors.background}aa`,
          boxShadow: isOnline
            ? `0 0 20px ${glow}1a, inset 0 0 40px ${glow}08`
            : selected
            ? `0 0 12px ${glow}33`
            : 'none',
        }}
      >
        {/* Header bar */}
        <div
          className="flex items-center gap-2 px-2.5 py-1.5 shrink-0"
          style={{
            background: isOnline ? `${glow}18` : `${theme.colors.nodeIconBackground}88`,
            borderBottom: `1px solid ${isOnline ? `${glow}33` : theme.colors.handleBackground}`,
          }}
        >
          <div
            className="flex items-center justify-center w-5 h-5 rounded-md shrink-0"
            style={{
              color: isOnline ? colors.icon : theme.colors.nodeSubtextColor,
              background: theme.colors.nodeIconBackground,
            }}
          >
            <Layers size={12} />
          </div>
          <div className="flex flex-col min-w-0 flex-1">
            <span
              className="text-[11px] font-semibold leading-tight truncate"
              style={{ color: isOnline ? glow : theme.colors.nodeLabelColor }}
            >
              {data.label}
            </span>
            {data.ip && (
              <span
                className="font-mono text-[9px] truncate"
                style={{ color: theme.colors.nodeSubtextColor }}
              >
                {data.ip}
              </span>
            )}
          </div>
          {/* Status dot */}
          <div
            className="w-1.5 h-1.5 rounded-full shrink-0"
            style={{ backgroundColor: statusColor }}
            title={data.status}
          />
          
          {/* Sync Button */}
          <button
            onClick={handleSync}
            disabled={isSyncing}
            className="p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 transition-colors z-50 pointer-events-auto"
            title="Sync Resources"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} style={{ color: theme.colors.nodeSubtextColor }} />
          </button>
        </div>

        {/* Inner area — React Flow places children here */}
        <div className="flex-1 relative" />
      </div>

      <Handle
        type="source"
        position={Position.Top}
        id="top"
        style={{ background: theme.colors.handleBackground, borderColor: theme.colors.handleBorder }}
      />
      <Handle type="target" position={Position.Top} id="top-t" style={{ opacity: 0, width: 12, height: 12 }} />
      <Handle
        type="source"
        position={Position.Bottom}
        id="bottom"
        style={{ background: theme.colors.handleBackground, borderColor: theme.colors.handleBorder }}
      />
      <Handle type="target" position={Position.Bottom} id="bottom-t" style={{ opacity: 0, width: 12, height: 12 }} />

      {/* Cluster handles */}
      <Handle
        type="source"
        position={Position.Left}
        id="cluster-left"
        title="Same cluster"
        style={{ background: proxmoxAccent, borderColor: `${proxmoxAccent}88`, width: 6, height: 6 }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="cluster-right"
        title="Same cluster"
        style={{ background: proxmoxAccent, borderColor: `${proxmoxAccent}88`, width: 6, height: 6 }}
      />
    </>
  )
}
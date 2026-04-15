import type { Node, Edge } from '@xyflow/react'
import type { NodeData, EdgeData, EdgeType } from '@/types'
import type { YamlNode, YamlNodeConnection } from '@/types/yaml'
import yaml from 'js-yaml'

/** Build a map of node id → label for edge resolution */
function buildIdToLabel(nodes: Node<NodeData>[]): Map<string, string> {
  const m = new Map<string, string>()
  for (const n of nodes) m.set(n.id, n.data.label)
  return m
}

function makeConnection(
  targetLabel: string,
  edgeType: EdgeType,
  edgeLabel: string | undefined,
  customColor?: string | null,
  sourceHandle?: string | null,
  targetHandle?: string | null,
): YamlNodeConnection {
  return {
    label: targetLabel,
    linkType: edgeType,
    ...(edgeLabel ? { linkLabel: edgeLabel } : {}),
    ...(customColor ? { linkColor: customColor } : {}),
    ...(sourceHandle ? { linkSourceHandle: sourceHandle } : {}),
    ...(targetHandle ? { linkTargetHandle: targetHandle } : {}),
  }
}

/**
 * Serialize React Flow canvas state to a YAML string.
 * Each node becomes one entry; edges are embedded as parent/clusterR/clusterL sub-objects.
 * Edge deduplication: each edge is written on exactly one side (source as clusterR, target as clusterL)
 * unless the edge type is 'virtual' or there is a parentId relationship, in which case
 * it becomes the 'parent' field of the child node.
 */
export function exportCanvasToYaml(nodes: Node<NodeData>[], edges: Edge<EdgeData>[]): string {
  const idToLabel = buildIdToLabel(nodes)

  // Build per-node edge maps (id → connections)
  // We use a Set to track already-serialized edge ids (deduplication).
  const serializedEdges = new Set<string>()

  // Index edges by source and target for quick lookup
  const edgesBySource = new Map<string, Edge<EdgeData>[]>()
  const edgesByTarget = new Map<string, Edge<EdgeData>[]>()
  for (const e of edges) {
    if (!edgesBySource.has(e.source)) edgesBySource.set(e.source, [])
    edgesBySource.get(e.source)!.push(e)
    if (!edgesByTarget.has(e.target)) edgesByTarget.set(e.target, [])
    edgesByTarget.get(e.target)!.push(e)
  }

  const yamlNodes: YamlNode[] = []

  for (const node of nodes) {
    const d = node.data

    // Skip groupRect nodes — they are canvas decoration only
    if (d.type === 'groupRect') continue

    const entry: YamlNode = {
      nodeType: d.type,
      label: d.label,
    }

    if (d.custom_icon) entry.nodeIcon = d.custom_icon
    if (d.hostname) entry.hostname = d.hostname
    if (d.ip) entry.ipAddress = d.ip
    if (d.check_method && d.check_method !== 'none') entry.checkMethod = d.check_method
    if (d.check_target) entry.checkTarget = d.check_target
    if (d.notes) entry.notes = d.notes

    // Hardware specs — omit zero values
    if (d.cpu_model) entry.cpuModel = d.cpu_model
    if (d.cpu_count && d.cpu_count > 0) entry.cpuCore = d.cpu_count
    if (d.ram_gb && d.ram_gb > 0) entry.ram = d.ram_gb
    if (d.disk_gb && d.disk_gb > 0) entry.disk = d.disk_gb
    if (d.type === 'proxmox' && d.container_mode) entry.containerMode = true

    // Parent relationship: if this node has a parentId in React Flow,
    // encode it as a 'parent' connection using any virtual edge between them.
    if (node.parentId) {
      const parentLabel = idToLabel.get(node.parentId) ?? node.parentId
      // Find an edge between parent and this node (either direction)
      const parentEdges = [
        ...(edgesBySource.get(node.parentId) ?? []).filter((e) => e.target === node.id),
        ...(edgesByTarget.get(node.parentId) ?? []).filter((e) => e.source === node.id),
      ]
      const pEdge = parentEdges[0]
      const linkType: EdgeType = (pEdge?.data?.type as EdgeType) ?? 'virtual'
      const linkLabel = (pEdge?.data?.label as string | undefined) ?? ''
      const linkColor = pEdge?.data?.custom_color as string | undefined
      entry.parent = makeConnection(parentLabel, linkType, linkLabel || undefined, linkColor, pEdge?.sourceHandle, pEdge?.targetHandle)
      if (pEdge) serializedEdges.add(pEdge.id)
    }

    // Outgoing edges (this node is the source):
    // - cluster type → clusterR (Proxmox cluster link, directional)
    // - everything else → links array (supports multiple connections)
    const outgoingEdges = (edgesBySource.get(node.id) ?? []).filter(
      (e) => !serializedEdges.has(e.id) && e.target !== node.parentId,
    )
    for (const e of outgoingEdges) {
      const targetLabel = idToLabel.get(e.target)
      if (!targetLabel) continue
      const edgeType: EdgeType = (e.data?.type as EdgeType) ?? 'ethernet'
      const edgeLabel = e.data?.label as string | undefined
      const edgeColor = e.data?.custom_color as string | undefined
      const conn = makeConnection(targetLabel, edgeType, edgeLabel, edgeColor, e.sourceHandle, e.targetHandle)
      if (edgeType === 'cluster') {
        if (!entry.clusterR) entry.clusterR = conn
      } else {
        entry.links = [...(entry.links ?? []), conn]
      }
      serializedEdges.add(e.id)
    }

    // Incoming cluster edges not yet serialized → clusterL
    const incomingClusterEdges = (edgesByTarget.get(node.id) ?? []).filter(
      (e) => !serializedEdges.has(e.id) && (e.data?.type as EdgeType) === 'cluster',
    )
    for (const e of incomingClusterEdges) {
      const sourceLabel = idToLabel.get(e.source)
      if (!sourceLabel) continue
      const edgeLabel = e.data?.label as string | undefined
      const edgeColor = e.data?.custom_color as string | undefined
      if (!entry.clusterL) entry.clusterL = makeConnection(sourceLabel, 'cluster', edgeLabel, edgeColor, e.sourceHandle, e.targetHandle)
      serializedEdges.add(e.id)
    }

    yamlNodes.push(entry)
  }

  return yaml.dump(yamlNodes, { lineWidth: -1, noRefs: true })
}

/** Trigger a browser file download with the given YAML content */
export function downloadYaml(content: string, filename = 'homelable-export.yaml'): void {
  const blob = new Blob([content], { type: 'text/yaml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

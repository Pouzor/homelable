import yaml from 'js-yaml'
import type { Node, Edge } from '@xyflow/react'
import type { NodeData, EdgeData } from '@/types'
import type { YamlNode, YamlNodeConnection } from '@/types/yaml'
import { generateUUID } from '@/utils/uuid'
import { applyDagreLayout } from '@/utils/layout'

/**
 * Parse a YAML string and merge the resulting nodes/edges into the existing canvas.
 * - Nodes with the same label as an existing node are skipped (no duplicates).
 * - Positions are computed via dagre auto-layout over the full merged set.
 */
export function parseYamlToCanvas(
  yamlString: string,
  existingNodes: Node<NodeData>[],
  existingEdges: Edge<EdgeData>[],
): { nodes: Node<NodeData>[]; edges: Edge<EdgeData>[]; imported: number } {
  const raw = yaml.load(yamlString)

  if (!Array.isArray(raw)) {
    throw new Error('YAML must be a list of node objects (top-level array)')
  }

  const entries = raw as unknown[]

  // Build lookup: label → existing node id (existing canvas + nodes being added)
  const labelToId = new Map<string, string>()
  for (const n of existingNodes) {
    labelToId.set(n.data.label, n.id)
  }

  // First pass: validate and create nodes (without positions — dagre will assign them)
  const newNodes: Node<NodeData>[] = []
  const yamlNodes: YamlNode[] = []

  for (const entry of entries) {
    const raw = entry as Record<string, unknown>

    if (!raw.nodeType || typeof raw.nodeType !== 'string') {
      throw new Error(`Each YAML entry must have a "nodeType" string field`)
    }
    if (!raw.label || typeof raw.label !== 'string') {
      throw new Error(`Each YAML entry must have a "label" string field`)
    }

    const yn = raw as unknown as YamlNode

    // Skip if a node with this label already exists on the canvas
    if (labelToId.has(yn.label)) {
      console.warn(`[importYaml] Skipping duplicate label: "${yn.label}"`)
      continue
    }

    const id = generateUUID()
    labelToId.set(yn.label, id)

    const hasHardware = !!(yn.cpuModel || yn.cpuCore || yn.ram || yn.disk)

    const data: NodeData = {
      label: yn.label,
      type: yn.nodeType,
      status: 'unknown',
      services: [],
      ...(yn.hostname ? { hostname: yn.hostname } : {}),
      ...(yn.ipAddress ? { ip: yn.ipAddress } : {}),
      ...(yn.checkMethod ? { check_method: yn.checkMethod } : {}),
      ...(yn.checkTarget ? { check_target: yn.checkTarget } : {}),
      ...(yn.notes ? { notes: yn.notes } : {}),
      ...(yn.nodeIcon ? { custom_icon: yn.nodeIcon } : {}),
      ...(yn.cpuModel ? { cpu_model: yn.cpuModel } : {}),
      ...(yn.cpuCore ? { cpu_count: yn.cpuCore } : {}),
      ...(yn.ram ? { ram_gb: yn.ram } : {}),
      ...(yn.disk ? { disk_gb: yn.disk } : {}),
      ...(hasHardware ? { show_hardware: true } : {}),
    }

    newNodes.push({
      id,
      type: yn.nodeType,
      position: { x: 0, y: 0 },
      data,
    })

    yamlNodes.push(yn)
  }

  // Second pass: apply parent relationships (parentId / parent_id)
  const newEdges: Edge<EdgeData>[] = []
  // Track edge pairs to deduplicate (store as "sourceId|targetId")
  const edgePairs = new Set<string>(
    existingEdges.map((e) => `${e.source}|${e.target}`)
  )

  function addEdgeIfNew(
    sourceId: string,
    targetId: string,
    conn: YamlNodeConnection,
  ) {
    const key = `${sourceId}|${targetId}`
    const reverseKey = `${targetId}|${sourceId}`
    if (edgePairs.has(key) || edgePairs.has(reverseKey)) return
    edgePairs.add(key)
    const edgeType = conn.linkType ?? 'ethernet'
    newEdges.push({
      id: generateUUID(),
      source: sourceId,
      target: targetId,
      type: edgeType,
      data: {
        type: edgeType,
        ...(conn.linkLabel ? { label: conn.linkLabel } : {}),
      },
    })
  }

  for (let i = 0; i < newNodes.length; i++) {
    const node = newNodes[i]
    const yn = yamlNodes[i]

    if (yn.parent) {
      const parentId = labelToId.get(yn.parent.label)
      if (!parentId) {
        console.warn(`[importYaml] parent label not found: "${yn.parent.label}" — skipping relationship`)
      } else {
        // Set React Flow parentId for nesting
        node.data = { ...node.data, parent_id: parentId }
        node.parentId = parentId
        node.extent = 'parent'
        // Also create an edge
        addEdgeIfNew(parentId, node.id, yn.parent)
      }
    }

    if (yn.clusterR) {
      const targetId = labelToId.get(yn.clusterR.label)
      if (!targetId) {
        console.warn(`[importYaml] clusterR label not found: "${yn.clusterR.label}" — skipping`)
      } else {
        addEdgeIfNew(node.id, targetId, yn.clusterR)
      }
    }

    if (yn.clusterL) {
      const sourceId = labelToId.get(yn.clusterL.label)
      if (!sourceId) {
        console.warn(`[importYaml] clusterL label not found: "${yn.clusterL.label}" — skipping`)
      } else {
        addEdgeIfNew(sourceId, node.id, yn.clusterL)
      }
    }
  }

  // Merge and apply layout
  const mergedNodes = [...existingNodes, ...newNodes]
  const mergedEdges = [...existingEdges, ...newEdges]
  const laidOut = applyDagreLayout(mergedNodes, mergedEdges)

  return { nodes: laidOut, edges: mergedEdges, imported: newNodes.length }
}

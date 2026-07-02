import type { Node, Edge } from '@xyflow/react'
import type { NodeData, EdgeData, Waypoint } from '@/types'
import { normalizeHandle, clampBottomHandles } from '@/utils/handleUtils'

// ── Types ────────────────────────────────────────────────────────────────────

export interface ApiNode extends Record<string, unknown> {
  id: string
  type: string
  label: string
  pos_x: number
  pos_y: number
  status: string
  services: unknown[]
  hostname?: string | null
  ip?: string | null
  mac?: string | null
  os?: string | null
  check_method?: string | null
  check_target?: string | null
  notes?: string | null
  parent_id?: string | null
  container_mode?: boolean
  custom_colors?: Record<string, unknown> | null
  custom_icon?: string | null
  cpu_count?: number | null
  cpu_model?: string | null
  ram_gb?: number | null
  disk_gb?: number | null
  show_hardware?: boolean
  properties?: unknown[] | null
  width?: number | null
  height?: number | null
  bottom_handles?: number
  show_port_numbers?: boolean
}

export interface ApiEdge {
  id: string
  source: string
  target: string
  type: string
  label?: string | null
  vlan_id?: number | null
  speed?: string | null
  custom_color?: string | null
  path_style?: string | null
  animated?: boolean | 'snake' | 'flow' | 'basic' | 'none'
  source_handle?: string | null
  target_handle?: string | null
  waypoints?: Waypoint[] | null
}

// ── Serialization (RF node → API save payload) ───────────────────────────────

export function serializeNode(n: Node<NodeData>): Record<string, unknown> {
  if (n.data.type === 'groupRect') {
    return {
      id: n.id,
      type: 'groupRect',
      label: n.data.label,
      hostname: null,
      ip: null,
      mac: null,
      os: null,
      status: 'unknown',
      check_method: null,
      check_target: null,
      services: [],
      notes: null,
      parent_id: n.data.parent_id ?? null,
      container_mode: false,
      custom_icon: null,
      pos_x: n.position.x,
      pos_y: n.position.y,
      custom_colors: {
        ...n.data.custom_colors,
        width: n.width ?? n.measured?.width ?? 360,
        height: n.height ?? n.measured?.height ?? 240,
        // Stash collapse state inside custom_colors so the API/YAML blob does
        // not need a new column. Hoisted back to `data.collapsed` on load.
        collapsed: n.data.collapsed ?? false,
      },
    }
  }
  return {
    id: n.id,
    type: n.data.type,
    label: n.data.label,
    hostname: n.data.hostname ?? null,
    ip: n.data.ip ?? null,
    mac: n.data.mac ?? null,
    os: n.data.os ?? null,
    status: n.data.status,
    check_method: n.data.check_method ?? null,
    check_target: n.data.check_target ?? null,
    services: n.data.services ?? [],
    notes: n.data.notes ?? null,
    parent_id: n.data.parent_id ?? null,
    container_mode: n.data.container_mode ?? false,
    // Stash collapse state inside the custom_colors blob so the backend's
    // dict[str, Any] column carries it without a schema change. Hoisted
    // back to `data.collapsed` on load. Applies to every node type — group
    // containers, Proxmox hosts, etc. — not just groupRect zones.
    custom_colors: n.data.collapsed !== undefined
      ? { ...(n.data.custom_colors ?? {}), collapsed: n.data.collapsed }
      : (n.data.custom_colors ?? null),
    custom_icon: n.data.custom_icon ?? null,
    cpu_count: n.data.cpu_count ?? null,
    cpu_model: n.data.cpu_model ?? null,
    ram_gb: n.data.ram_gb ?? null,
    disk_gb: n.data.disk_gb ?? null,
    show_hardware: n.data.show_hardware ?? false,
    properties: n.data.properties ?? [],
    // Prefer the explicit (resized) dimension over the DOM-measured one so a
    // manual resize persists its exact target instead of drifting to the
    // fractional content-fit value.
    width: n.width ?? n.measured?.width ?? null,
    height: n.height ?? n.measured?.height ?? null,
    bottom_handles: clampBottomHandles(n.data.bottom_handles ?? 1),
    show_port_numbers: n.data.show_port_numbers ?? false,
    pos_x: n.position.x,
    pos_y: n.position.y,
  }
}

export function serializeEdge(e: Edge<EdgeData>): Record<string, unknown> {
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    type: e.data?.type ?? 'ethernet',
    label: e.data?.label ?? null,
    vlan_id: e.data?.vlan_id ?? null,
    speed: e.data?.speed ?? null,
    custom_color: e.data?.custom_color ?? null,
    path_style: e.data?.path_style ?? null,
    animated: e.data?.animated ?? false,
    source_handle: normalizeHandle(e.sourceHandle),
    target_handle: normalizeHandle(e.targetHandle),
    waypoints: e.data?.waypoints?.length ? e.data.waypoints : null,
  }
}

// ── Deserialization (API response → RF node/edge) ────────────────────────────

export function deserializeApiNode(
  n: ApiNode,
  proxmoxContainerMap: Map<string, boolean>,
): Node<NodeData> {
  const normalizedType = n.type === 'docker' ? 'docker_host' : n.type
  if (n.type === 'groupRect') {
    const w = (n.custom_colors?.width as number | undefined) ?? 360
    const h = (n.custom_colors?.height as number | undefined) ?? 240
    const z = (n.custom_colors?.z_order as number | undefined) ?? 1
    // Hoist persisted collapse flag from the custom_colors stash to a
    // first-class field on NodeData. Tolerates legacy saves that already had
    // it there from before the type was promoted.
    const collapsed = Boolean(n.custom_colors?.collapsed)
    return {
      id: n.id,
      type: 'groupRect',
      position: { x: n.pos_x, y: n.pos_y },
      data: { ...(n as unknown as NodeData), collapsed },
      width: w,
      height: h,
      zIndex: z - 10,
      ...(n.parent_id ? { parentId: n.parent_id, extent: 'parent' as const } : {}),
    }
  }
  const parentIsContainer = n.parent_id ? (proxmoxContainerMap.get(n.parent_id) ?? false) : false
  return {
    id: n.id,
    type: normalizedType,
    position: { x: n.pos_x, y: n.pos_y },
    // Hoist persisted collapse flag from the custom_colors stash (matches
    // the symmetric serialize step). Applies to every node type.
    data: {
      ...n,
      type: normalizedType,
      bottom_handles: clampBottomHandles(n.bottom_handles ?? 1),
      collapsed: Boolean(n.custom_colors?.collapsed),
    } as unknown as NodeData,
    ...(n.parent_id && parentIsContainer ? { parentId: n.parent_id, extent: 'parent' as const } : {}),
    // Container hosts (Proxmox/VM/LXC/docker in container_mode) get a default
    // box if none was saved. Every other node — including LEAF vm/lxc/docker
    // nodes nested inside a container — restores its own saved width/height.
    // Gating on container_mode (not type) is what keeps a resized nested node
    // from snapping back to content-fit on reload.
    ...(['proxmox', 'vm', 'lxc', 'docker_host'].includes(normalizedType) && n.container_mode !== false
      ? { width: n.width ?? 300, height: n.height ?? 200 }
      : {
          ...(n.width ? { width: n.width } : {}),
          ...(n.height ? { height: n.height } : {}),
        }),
  }
}

export function deserializeApiEdge(e: ApiEdge): Edge<EdgeData> {
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    type: e.type,
    sourceHandle: e.source_handle ?? null,
    targetHandle: e.target_handle ?? null,
    data: e as unknown as EdgeData,
  }
}

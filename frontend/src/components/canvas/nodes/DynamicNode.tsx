import * as Nodes from './index'
import { ContainerGroupNode } from './ContainerGroupNode'

import type { Node, NodeProps } from '@xyflow/react'
import type { NodeData, NodeType } from '@/types'

type AppNode = Node<NodeData, NodeType>
type AppNodeProps = NodeProps<AppNode>

const BASE_NODE_MAP: Record<NodeType, React.ComponentType<AppNodeProps>> = {
  isp: Nodes.IspNode,
  firewall: Nodes.FirewallNode,
  router: Nodes.RouterNode,
  switch: Nodes.SwitchNode,
  server: Nodes.ServerNode,
  nas: Nodes.NasNode,
  ap: Nodes.ApNode,
  printer: Nodes.PrinterNode,
  proxmox: Nodes.ProxmoxNode,
  vm: Nodes.VmNode,
  lxc: Nodes.LxcNode,
  docker_host: Nodes.DockerHostNode,
  docker_container: Nodes.DockerContainerNode,
  iot: Nodes.IotNode,
  camera: Nodes.CameraNode,
  cpl: Nodes.CplNode,
  computer: Nodes.ComputerNode,
  generic: Nodes.GenericNode,
  groupRect: Nodes.GenericNode,
  group: Nodes.GenericNode,
  zigbee_coordinator: Nodes.ZigbeeCoordinatorNode,
  zigbee_router: Nodes.ZigbeeRouterNode,
  zigbee_enddevice: Nodes.ZigbeeEndDeviceNode,
}

export function DynamicNode(props: AppNodeProps) {
  const { data, type } = props

  if (data?.container_mode) {
    return <ContainerGroupNode {...props} />
  }

  const BaseNode = BASE_NODE_MAP[type as NodeType] ?? Nodes.GenericNode

  return <BaseNode {...props} />
}
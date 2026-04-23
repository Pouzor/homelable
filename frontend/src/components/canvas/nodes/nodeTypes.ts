import { DynamicNode } from './DynamicNode'
import { GroupRectNode } from './GroupRectNode'
import { GroupNode } from './GroupNode'
import { TextNode } from './TextNode'
import { ZigbeeCoordinatorNode, ZigbeeRouterNode, ZigbeeEndDeviceNode } from './index'

export const nodeTypes = {
  isp: DynamicNode,
  firewall: DynamicNode,
  router: DynamicNode,
  switch: DynamicNode,
  server: DynamicNode,
  nas: DynamicNode,
  ap: DynamicNode,
  printer: DynamicNode,
  proxmox: DynamicNode,
  vm: DynamicNode,
  lxc: DynamicNode,
  docker_host: DynamicNode,
  docker_container: DynamicNode,
  iot: DynamicNode,
  camera: DynamicNode,
  cpl: DynamicNode,
  computer: DynamicNode,
  generic: DynamicNode,
  groupRect: GroupRectNode,
  group: GroupNode,
  text: TextNode,
  zigbee_coordinator: ZigbeeCoordinatorNode,
  zigbee_router: ZigbeeRouterNode,
  zigbee_enddevice: ZigbeeEndDeviceNode,
}

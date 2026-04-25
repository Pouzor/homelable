import { DynamicNode } from './DynamicNode'
import { GroupRectNode } from './GroupRectNode'
import { GroupNode } from './GroupNode'

export const nodeTypes = {
  isp: DynamicNode,
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
}
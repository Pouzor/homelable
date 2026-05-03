import { IspNode, RouterNode, FirewallNode, SwitchNode, ServerNode, VmNode, LxcNode, NasNode, IotNode, ApNode, CameraNode, PrinterNode, ComputerNode, CplNode, DockerHostNode, DockerContainerNode, GenericNode } from './index'
import { ProxmoxGroupNode } from './ProxmoxGroupNode'
import { GroupRectNode } from './GroupRectNode'
import { GroupNode } from './GroupNode'

export const nodeTypes = {
  isp: IspNode,
  router: RouterNode,
  firewall: FirewallNode,
  switch: SwitchNode,
  server: ServerNode,
  proxmox: ProxmoxGroupNode,
  vm: VmNode,
  lxc: LxcNode,
  nas: NasNode,
  iot: IotNode,
  ap: ApNode,
  camera: CameraNode,
  printer: PrinterNode,
  computer: ComputerNode,
  cpl: CplNode,
  docker_host: DockerHostNode,
  docker_container: DockerContainerNode,
  generic: GenericNode,
  groupRect: GroupRectNode,
  group: GroupNode,
}

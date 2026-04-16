import { IspNode, RouterNode, SwitchNode, ServerNode, VmNode, LxcNode, NasNode, IotNode, ApNode, CameraNode, PrinterNode, ComputerNode, CplNode, DockerNode, GenericNode } from './index'
import { ProxmoxGroupNode } from './ProxmoxGroupNode'
import { GroupRectNode } from './GroupRectNode'
import { GroupNode } from './GroupNode'

export const nodeTypes = {
  isp: IspNode,
  router: RouterNode,
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
  docker_host: DockerNode,
  generic: GenericNode,
  groupRect: GroupRectNode,
  group: GroupNode,
}

import { IspNode, RouterNode, SwitchNode, ServerNode, VmNode, LxcNode, NasNode, IotNode, ApNode, CameraNode, GenericNode } from './index'
import { ProxmoxGroupNode } from './ProxmoxGroupNode'

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
  generic: GenericNode,
}

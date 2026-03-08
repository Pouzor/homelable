import { type NodeProps, type Node } from '@xyflow/react'
import {
  Globe, Router, Network, Server, Layers, Box, Container,
  HardDrive, Cpu, Wifi, Circle, Camera,
} from 'lucide-react'
import { BaseNode } from './BaseNode'
import type { NodeData } from '@/types'

type N = NodeProps<Node<NodeData>>

export const IspNode     = (props: N) => <BaseNode {...props} icon={Globe} />
export const RouterNode  = (props: N) => <BaseNode {...props} icon={Router} />
export const SwitchNode  = (props: N) => <BaseNode {...props} icon={Network} />
export const ServerNode  = (props: N) => <BaseNode {...props} icon={Server} />
export const ProxmoxNode = (props: N) => <BaseNode {...props} icon={Layers} />
export const VmNode      = (props: N) => <BaseNode {...props} icon={Box} />
export const LxcNode     = (props: N) => <BaseNode {...props} icon={Container} />
export const NasNode     = (props: N) => <BaseNode {...props} icon={HardDrive} />
export const IotNode     = (props: N) => <BaseNode {...props} icon={Cpu} />
export const ApNode      = (props: N) => <BaseNode {...props} icon={Wifi} />
export const CameraNode  = (props: N) => <BaseNode {...props} icon={Camera} />
export const GenericNode = (props: N) => <BaseNode {...props} icon={Circle} />

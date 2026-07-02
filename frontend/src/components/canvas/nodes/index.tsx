import { type NodeProps, type Node } from '@xyflow/react'
import {
  Globe, Router, Network, Server, Layers, Box, Container,
  HardDrive, Cpu, Wifi, Circle, Cctv, Printer, Monitor, Laptop, Smartphone, PlugZap, Anchor, Package, Flame, Radio, Antenna, RadioTower, Share2,
  Grid3x3, Battery, Fuel, Sun, Repeat2, Split, ToggleLeft, Lightbulb, Gauge, Combine, Cable, Zap,
} from 'lucide-react'
import { BaseNode } from './BaseNode'
import type { NodeData } from '@/types'

type N = NodeProps<Node<NodeData>>

export const IspNode     = (props: N) => <BaseNode {...props} icon={Globe} />
export const RouterNode  = (props: N) => <BaseNode {...props} icon={Router} />
export const FirewallNode = (props: N) => <BaseNode {...props} icon={Flame} />
export const SwitchNode  = (props: N) => <BaseNode {...props} icon={Network} />
export const ServerNode  = (props: N) => <BaseNode {...props} icon={Server} />
export const ProxmoxNode = (props: N) => <BaseNode {...props} icon={Layers} />
export const VmNode      = (props: N) => <BaseNode {...props} icon={Box} />
export const LxcNode     = (props: N) => <BaseNode {...props} icon={Container} />
export const NasNode     = (props: N) => <BaseNode {...props} icon={HardDrive} />
export const IotNode     = (props: N) => <BaseNode {...props} icon={Cpu} />
export const ApNode      = (props: N) => <BaseNode {...props} icon={Wifi} />
export const CameraNode   = (props: N) => <BaseNode {...props} icon={Cctv} />
export const PrinterNode  = (props: N) => <BaseNode {...props} icon={Printer} />
export const ComputerNode = (props: N) => <BaseNode {...props} icon={Monitor} />
export const LaptopNode   = (props: N) => <BaseNode {...props} icon={Laptop} />
export const MobileNode   = (props: N) => <BaseNode {...props} icon={Smartphone} />
export const CplNode      = (props: N) => <BaseNode {...props} icon={PlugZap} />
export const DockerHostNode      = (props: N) => <BaseNode {...props} icon={Anchor} />
export const DockerContainerNode = (props: N) => <BaseNode {...props} icon={Package} />
export const GenericNode  = (props: N) => <BaseNode {...props} icon={Circle} />
// Zigbee node types
export const ZigbeeCoordinatorNode = (props: N) => <BaseNode {...props} icon={Network} />
export const ZigbeeRouterNode      = (props: N) => <BaseNode {...props} icon={Radio} />
export const ZigbeeEndDeviceNode   = (props: N) => <BaseNode {...props} icon={Antenna} />

// Z-Wave node types
export const ZwaveCoordinatorNode = (props: N) => <BaseNode {...props} icon={RadioTower} />
export const ZwaveRouterNode      = (props: N) => <BaseNode {...props} icon={Share2} />
export const ZwaveEndDeviceNode   = (props: N) => <BaseNode {...props} icon={Antenna} />

// Electrical node types
export const GridNode          = (props: N) => <BaseNode {...props} icon={Grid3x3} />
export const UpsNode           = (props: N) => <BaseNode {...props} icon={Battery} />
export const BatteryNode        = (props: N) => <BaseNode {...props} icon={Battery} />
export const GeneratorNode     = (props: N) => <BaseNode {...props} icon={Fuel} />
export const SolarPanelNode    = (props: N) => <BaseNode {...props} icon={Sun} />
export const InverterNode      = (props: N) => <BaseNode {...props} icon={Repeat2} />
export const CircuitBreakerNode = (props: N) => <BaseNode {...props} icon={Split} />
export const ContactorNode     = (props: N) => <BaseNode {...props} icon={ToggleLeft} />
export const ElectricalSwitchNode = (props: N) => <BaseNode {...props} icon={ToggleLeft} />
export const SocketNode        = (props: N) => <BaseNode {...props} icon={Cable} />
export const LightNode         = (props: N) => <BaseNode {...props} icon={Lightbulb} />
export const MeterNode         = (props: N) => <BaseNode {...props} icon={Gauge} />
export const TransformerNode   = (props: N) => <BaseNode {...props} icon={Combine} />
export const LoadNode          = (props: N) => <BaseNode {...props} icon={Zap} />

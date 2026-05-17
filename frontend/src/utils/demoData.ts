import type { Node, Edge } from '@xyflow/react'
import type { NodeData, EdgeData } from '@/types'

export const demoNodes: Node<NodeData>[] = [
  {
    id: 'isp-1',
    type: 'isp',
    position: { x: 300, y: 20 },
    data: { label: 'Freebox Ultra', type: 'isp', ip: '10.0.0.1', status: 'online', services: [] },
  },
  {
    id: 'router-1',
    type: 'router',
    position: { x: 300, y: 140 },
    data: { label: 'OpnSense', type: 'router', hostname: 'opnsense.lan', ip: '192.168.1.1', status: 'online', check_method: 'ping', services: [] },
  },
  {
    id: 'switch-1',
    type: 'switch',
    position: { x: 140, y: 260 },
    data: { label: 'Netgear GS308', type: 'switch', ip: '192.168.1.2', status: 'online', services: [] },
  },
  {
    id: 'switch-2',
    type: 'switch',
    position: { x: 460, y: 260 },
    data: { label: 'TP-Link TL-SG108', type: 'switch', ip: '192.168.1.3', status: 'unknown', services: [] },
  },
  {
    id: 'proxmox-1',
    type: 'proxmox',
    position: { x: 60, y: 380 },
    data: { label: 'PVE01', type: 'proxmox', hostname: 'pve01.lan', ip: '192.168.1.10', os: 'Proxmox VE 8.2', status: 'online', check_method: 'https', check_target: 'https://192.168.1.10:8006', services: [{ port: 8006, protocol: 'tcp', service_name: 'Proxmox VE', category: 'hypervisor' }] },
  },
  {
    id: 'server-1',
    type: 'server',
    position: { x: 300, y: 380 },
    data: { label: 'NAS-01', type: 'nas', hostname: 'nas.lan', ip: '192.168.1.20', status: 'online', check_method: 'http', services: [{ port: 5000, protocol: 'tcp', service_name: 'Synology DSM', category: 'nas' }] },
  },
  {
    id: 'ap-1',
    type: 'ap',
    position: { x: 460, y: 380 },
    data: { label: 'UniFi AP', type: 'ap', ip: '192.168.1.30', status: 'online', check_method: 'ping', services: [] },
  },
  {
    id: 'vm-1',
    type: 'vm',
    position: { x: 20, y: 500 },
    data: { label: 'Home Assistant', type: 'vm', hostname: 'ha.lan', ip: '192.168.1.11', status: 'online', check_method: 'http', services: [{ port: 8123, protocol: 'tcp', service_name: 'Home Assistant', category: 'automation' }] },
  },
  {
    id: 'lxc-1',
    type: 'lxc',
    position: { x: 140, y: 500 },
    data: { label: 'Portainer', type: 'lxc', hostname: 'portainer.lan', ip: '192.168.1.12', status: 'offline', check_method: 'https', services: [{ port: 9443, protocol: 'tcp', service_name: 'Portainer', category: 'containers' }] },
  },
  {
    id: 'iot-1',
    type: 'iot',
    position: { x: 460, y: 500 },
    data: { label: 'Zigbee Hub', type: 'iot', ip: '192.168.2.1', status: 'pending', check_method: 'tcp', services: [] },
  },
  {
    id: 'demo-text-1',
    type: 'text',
    position: { x: 660, y: 20 },
    data: {
      label: 'Demo banner',
      type: 'text',
      status: 'unknown',
      services: [],
      text_content: 'This is demo canvas, start with fresh scan',
      custom_colors: {
        text_color: '#e6edf3',
        text_size: 14,
        font: 'inter',
        border: '#00d4ff',
        border_style: 'dashed',
        border_width: 1,
        background: '#00d4ff14',
      },
    },
  },
  {
    id: 'demo-text-2',
    type: 'text',
    position: { x: -240, y: 540 },
    data: {
      label: 'Demo hint',
      type: 'text',
      status: 'unknown',
      services: [],
      text_content: 'You can remove all nodes',
      custom_colors: {
        text_color: '#8b949e',
        text_size: 12,
        font: 'inter',
        border: '#30363d',
        border_style: 'dotted',
        border_width: 1,
        background: '#00000000',
      },
    },
  },
]

export const demoEdges: Edge<EdgeData>[] = [
  { id: 'e1', source: 'isp-1', sourceHandle: 'bottom', target: 'router-1', targetHandle: 'top', type: 'ethernet', data: { type: 'ethernet' } },
  { id: 'e2', source: 'router-1', sourceHandle: 'bottom', target: 'switch-1', targetHandle: 'top', type: 'ethernet', data: { type: 'ethernet', label: '1G' } },
  { id: 'e3', source: 'router-1', sourceHandle: 'bottom', target: 'switch-2', targetHandle: 'top', type: 'ethernet', data: { type: 'ethernet', label: '1G' } },
  { id: 'e4', source: 'switch-1', sourceHandle: 'bottom', target: 'proxmox-1', targetHandle: 'top', type: 'ethernet', data: { type: 'ethernet' } },
  { id: 'e5', source: 'switch-1', sourceHandle: 'bottom', target: 'server-1', targetHandle: 'top', type: 'ethernet', data: { type: 'ethernet' } },
  { id: 'e6', source: 'switch-2', sourceHandle: 'bottom', target: 'ap-1', targetHandle: 'top', type: 'ethernet', data: { type: 'ethernet' } },
  { id: 'e7', source: 'proxmox-1', sourceHandle: 'bottom', target: 'vm-1', targetHandle: 'top', type: 'virtual', data: { type: 'virtual' } },
  { id: 'e8', source: 'proxmox-1', sourceHandle: 'bottom', target: 'lxc-1', targetHandle: 'top', type: 'virtual', data: { type: 'virtual' } },
  { id: 'e9', source: 'ap-1', sourceHandle: 'bottom', target: 'iot-1', targetHandle: 'top', type: 'wifi', data: { type: 'wifi' } },
  { id: 'e10', source: 'router-1', sourceHandle: 'bottom', target: 'server-1', targetHandle: 'top', type: 'vlan', data: { type: 'vlan', vlan_id: 20, label: 'VLAN 20' } },
]

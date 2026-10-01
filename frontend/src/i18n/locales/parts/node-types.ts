/**
 * Translations for `NODE_TYPE_LABELS` in ../../types — the device-type names
 * shown in the node-type picker, the search results and the detail panel.
 *
 * The dictionary key is the English label string, because the render sites pass
 * the table lookup straight to `t()`: `t(NODE_TYPE_LABELS[data.type])`. A type
 * the table does not know falls through to the raw key and renders in English,
 * which is the intended degradation (see ../../core.ts).
 *
 * Conventions (see ../GLOSSARY.md):
 *   - Product and protocol names stay verbatim: Proxmox, Zigbee, Z-Wave, Docker,
 *     IoT, CPL, KVM, LXC.
 *   - An English label that is *only* a technical token keeps itself as the
 *     translation — `NAS`, `UPS` and `Proxmox VE` below are deliberate identity
 *     entries, not missing ones. A blank value would be worse: `t()` treats it
 *     as absent and the dictionary would claim completeness it does not have.
 *   - `Router` and `Text` are already defined in components-integrations and
 *     components-modals-2 respectively, so they are deliberately absent here;
 *     a second definition would be a silent last-one-wins in zh-CN.ts.
 */
const part: Record<string, string> = {
  'Access Point': '无线接入点',
  'Battery': '电池',
  'Camera': '摄像头',
  'Circuit Breaker': '断路器',
  'CPL / Powerline': 'CPL / 电力线',
  'Cluster': '集群',
  'Computer': '电脑',
  'Contactor': '接触器',
  'Docker Container': 'Docker 容器',
  'Docker Host': 'Docker 主机',
  'Electrical Load': '电气负载',
  'Electrical Wire': '电线',
  'Energy Meter': '电表',
  'Ethernet': '以太网',
  'Fibre': '光纤',
  'Firewall': '防火墙',
  'Generator': '发电机',
  'Generic Device': '通用设备',
  'Grid Connection': '市电接入',
  'Group Rectangle': '分组矩形',
  'Inverter': '逆变器',
  'IoT / Zigbee': 'IoT / Zigbee',
  'IoT Device': 'IoT 设备',
  'ISP / Modem': 'ISP / 调制解调器',
  'KVM Switch': 'KVM 切换器',
  'Laptop': '笔记本',
  'Light Fixture': '灯具',
  'LXC Container': 'LXC 容器',
  'NAS': 'NAS',
  'Node Group': '节点分组',
  'Phone / Mobile': '手机 / 移动设备',
  'Printer': '打印机',
  'Proxmox VE': 'Proxmox VE',
  'Server': '服务器',
  'Socket / Outlet': '插座 / 排插',
  'Solar Panel': '太阳能板',
  'Switch': '交换机',
  'Transformer': '变压器',
  'UPS': 'UPS',
  'VLAN': 'VLAN',
  'Virtual': '虚拟',
  'Virtual Machine': '虚拟机',
  'Wi-Fi': 'Wi-Fi',
  'Z-Wave Controller': 'Z-Wave 控制器',
  'Z-Wave End Device': 'Z-Wave 终端设备',
  'Z-Wave Router': 'Z-Wave 路由器',
  'Zigbee Coordinator': 'Zigbee 协调器',
  'Zigbee End Device': 'Zigbee 终端设备',
  'Zigbee Mesh': 'Zigbee 网状网络',
  'Zigbee Router': 'Zigbee 路由器',
}

export default part

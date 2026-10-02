/**
 * Translations for the doc-template and import-source work stream.
 * Sourced from GLOSSARY.md. Merged into ../zh-CN.ts.
 *
 * `DOC_TEMPLATES` (documentation/types.ts) stays English in the data module: the
 * English source text is the key, and the picker resolves it with
 * `t(template.label)` / `t(template.hint)`. The `id` beside it is what the
 * backend matches on, so it is never wrapped. Same shape for the import tiles'
 * `description`, `imports` and `duration` fields in ImportSourceModal.
 */
const part: Record<string, string> = {
  '30 s – a few min': '30 秒 ~ 几分钟',
  'A–Z': 'A–Z',
  'Discovery source': '发现来源',
  'Group': '分组',
  'Physical / virtual': '物理 / 虚拟',
  'Zone': '区域',
  '~10 s': '约 10 秒',
  '~20 s': '约 20 秒',
  'A service spanning hosts': '跨多台主机的服务',
  'A title and nothing else': '只有一个标题，没有正文',
  'APs': 'AP',
  'Blank page': '空白页面',
  'Clients': '客户端',
  'Context, decision, consequences': '背景、决策、影响',
  'Decision (ADR)': '决策记录（ADR）',
  'Document title': '文档标题',
  'Gateways': '网关',
  'Goal, prerequisites, steps': '目标、前置条件、步骤',
  'Import from {source}': '从 {source} 导入',
  'Import from…': '导入来源…',
  'Incident': '故障',
  'LXC': 'LXC 容器',
  'Mesh links': '网状连线',
  'Neighbours': '邻居',
  'Network overview': '网络概览',
  'Pick a source to pull devices from. Everything lands in the Device Inventory first — nothing touches the canvas until you approve it.':
    '选择一个来源来拉取设备。所有内容会先进入设备清单，未经确认不会进入画布。',
  'Procedure': '操作流程',
  'Pulls the Z-Wave JS UI node list with each node’s neighbours, so the mesh keeps its shape.':
    '拉取 Z-Wave JS UI 的节点列表及各节点的邻居关系，保留整个网络的结构。',
  'Purpose, members, addressing': '用途、成员、寻址',
  'Queries the API for every node of the cluster and the guests running on them.':
    '通过 API 查询集群中的每台节点，以及运行在其上的客户机。',
  'Reads the coordinator over MQTT and brings the whole mesh in, routers and end devices alike.':
    '通过 MQTT 读取协调器，整网导入：路由节点与终端设备一视同仁。',
  'Runbook': '操作手册',
  'Service': '服务',
  'Switches': '交换机',
  "Talks to the controller for adopted gear, and optionally for the clients it sees.":
    '与控制器通信，获取已纳管的设备，并可选择获取它看到的客户端。',
  'Timeline, cause, fix': '时间线、原因、修复',
  'Topology, subnets, routing': '拓扑、子网、路由',
  'Trigger, steps, rollback': '触发条件、步骤、回滚',
  'VMs': '虚拟机',
  'with the mesh size': '取决于网络规模',
  'Zone / group': '区域 / 分组',
}

export default part

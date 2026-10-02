# Homelable 简体中文术语表

并行翻译时，多个文件经常出现同一个英文词。下面这些译法是**强制的**，避免同一个词在
不同页面翻成两样（`Save` 一处「保存」一处「储存」这种最伤专业感）。

## 交互动词

| English | 简体中文 |
|---|---|
| Save | 保存 |
| Cancel | 取消 |
| Delete | 删除 |
| Remove | 移除 |
| Edit | 编辑 |
| Close | 关闭 |
| Open | 打开 |
| Add | 添加 |
| Create | 新建 |
| Import | 导入 |
| Export | 导出 |
| Save as… | 另存为… |
| Copy | 复制 |
| Paste | 粘贴 |
| Duplicate | 复制副本 |
| Undo | 撤销 |
| Redo | 重做 |
| Retry | 重试 |
| Refresh | 刷新 |
| Search | 搜索 |
| Filter | 筛选 |
| Sort | 排序 |
| Apply | 应用 |
| Reset | 重置 |
| Rename | 重命名 |
| Select | 选择 |
| Deselect | 取消选择 |
| Confirm | 确认 |
| Upload | 上传 |
| Download | 下载 |
| Connect | 连接 |
| Disconnect | 断开 |
| Mount | 挂载 |
| Unmount | 卸载 |
| Scan | 扫描 |
| Sync | 同步 |
| Re-sync now | 立即重新同步 |
| Syncing… | 同步中… |
| Test | 测试 |
| Enable | 启用 |
| Disable | 禁用 |

## 名词

| English | 简体中文 |
|---|---|
| Canvas | 画布 |
| Node | 节点 |
| Edge | 连线 |
| Zone | 区域 |
| Rack | 机柜 |
| Port | 端口 |
| Device | 设备 |
| Devices | 设备 |
| Service | 服务 |
| Services | 服务 |
| Host | 主机 |
| Server | 服务器 |
| Switch | 交换机 |
| Router | 路由器 |

`Switch` 只有指**网络交换机**时才是「交换机」。设备名里的其它 switch 要按实际器件翻：
`KVM Switch` → `KVM 切换器`（键鼠/视频切换硬件，不是网络设备）。
| Firewall | 防火墙 |
| Storage | 存储 |
| Document | 文档 |
| Documentation | 文档中心 |
| Page | 页面 |
| Settings | 设置 |
| Library | 资料库 |
| Inventory | 设备清单 |
| Live View | 实时视图 |
| Read-only | 只读 |
| Style | 样式 |
| Theme | 主题 |
| Layout | 布局 |
| Auto Layout | 自动布局 |
| Snap distance | 吸附距离 |
| Alignment guides | 对齐参考线 |
| Status | 状态 |
| Health | 健康状态 |
| Version | 版本 |
| History | 历史 |
| Overview | 概览 |
| Details | 详情 |
| Name | 名称 |
| Label | 标签 |
| Type | 类型 |
| Description | 描述 |
| Notes | 备注 |
| Value | 值 |
| Default | 默认 |
| Example | 示例 |
| Optional | 可选 |
| Required | 必填 |
| Never | 从不 |
| Always | 始终 |
| Unassigned | 未分配 |
| Unknown | 未知 |
| Online | 在线 |
| Offline | 离线 |
| Degraded | 性能下降 |
| Pending | 待处理 |
| Approved | 已批准 |
| Rejected | 已拒绝 |
| Skipped | 已跳过 |
| Selected | 已选中 |
| Total | 合计 |
| Uptime | 在线时长 |
| Latency | 延迟 |
| Bandwidth | 带宽 |
| Address | 地址 |
| IP address | IP 地址 |
| MAC address | MAC 地址 |
| Subnet | 子网 |
| Credentials | 凭据 |
| Username | 用户名 |
| Password | 密码 |
| Sign in | 登录 |
| Sign out | 退出登录 |
| Language | 语言 |
| Interface language | 界面语言 |

## 保留原文、不翻译

以下属于专有名词或协议标识，**原样保留**（包括大小写）：

`Proxmox` `Z-Wave` `Zigbee` `MQTT` `YAML` `JSON` `UniFi` `Ubiquiti` `Home Assistant`
`UEFI` `UEFI` `PXE` `API` `URL` `HTTP` `HTTPS` `SSH` `TCP` `UDP` `DNS` `DHCP` `NTP`
`SNMP` `IP` `MAC` `CIDR` `VLAN` `LAG` `PoE` `SFP` `GBIC` `PNG` `SVG` `CSV` `WebDAV`
`WOL` `iDRAC` `iLO` `IPMI` `OpenID Connect` `OIDC` `CORS_ORIGINS` `LIVEVIEW_KEY`
`DOCS_VIEW_KEY` `MCP_API_KEY` `MCP_SERVICE_KEY` `AUTH_PASSWORD_HASH` `SECRET_KEY`

以及所有**环境变量名、配置项 key、枚举值、对象属性名、CSS 类名、`data-*` 属性**。

## 复数与占位符

中文没有复数变化，所以**英文里的复数后缀用 `{plural}` 占位**，译文里直接省略它：

```ts
// 英文
t('Imported {count} node{plural}', { count: imported, plural: imported !== 1 ? 's' : '' })
// 译文
'Imported {count} node{plural}': '已导入 {count} 个节点',
```

渲染结果：`已导入 1 个节点` / `已导入 5 个节点`——**数字照常保留**，不写「台/个」之外的量词折腾。

## 语气

界面文案用**简洁的祈使句/名词短语**，不要客套话，也不要翻译腔。
`Save the canvas first` → `请先保存画布`，不要写成「您需要首先保存画布」。

按钮、标签保持**短**（一般不超过 6 个汉字）；说明性文字可以稍长。

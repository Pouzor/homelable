/**
 * Copy the API can return in a FastAPI `detail`, translated.
 *
 * The backend is deliberately left in English — it is upstream code and a
 * message is an API contract, not display copy. Instead the frontend runs the
 * detail through `t()`: a known message comes back in Chinese, an unknown one
 * falls through as the English the server sent, so a backend change degrades
 * instead of breaking. See i18n/errorMessage.ts for the routing.
 *
 * Regenerate the key list with the extractor over backend/app/***.py; a
 * message the backend renames simply stops resolving.
 */
const part: Record<string, string> = {
  "A scan is already running for this device": "该设备已有扫描正在进行",
  "A text annotation cannot be a parent node": "文本标注不能作为父节点",
  "Cannot enable auto-sync: no Proxmox host/token configured in the server env.": "无法启用自动同步：服务器 .env 里没有配置 Proxmox 主机/令牌",
  "Cannot enable auto-sync: no UniFi host/credentials configured in the server env.": "无法启用自动同步：服务器 .env 里没有配置 UniFi 主机/凭据",
  "Cannot enable auto-sync: no Z-Wave MQTT host configured in the server env.": "无法启用自动同步：服务器 .env 里没有配置 Z-Wave MQTT 主机",
  "Cannot enable auto-sync: no Zigbee MQTT host configured in the server env.": "无法启用自动同步：服务器 .env 里没有配置 Zigbee MQTT 主机",
  "Cannot sync: no Proxmox host/token configured on the server.": "无法同步：服务器上没有配置 Proxmox 主机/令牌",
  "Cannot sync: no UniFi host/credentials configured on the server.": "无法同步：服务器上没有配置 UniFi 主机/凭据",
  "Cannot sync: no Z-Wave MQTT host configured on the server.": "无法同步：服务器上没有配置 Z-Wave MQTT 主机",
  "Cannot sync: no Zigbee MQTT host configured on the server.": "无法同步：服务器上没有配置 Zigbee MQTT 主机",
  "Custom Proxmox hosts require an explicit API token": "自定义 Proxmox 主机必须提供 API 令牌",
  "Device has no IP address to scan": "该设备没有可用于扫描的 IP 地址",
  "Device has no valid IP address to scan": "该设备没有有效的扫描 IP 地址",
  "Device is hidden": "设备已隐藏",
  "Device is mounted in a rack": "设备已安装在机柜中",
  "Device is not hidden": "设备未被隐藏",
  "Device not found": "未找到设备",
  "Documentation view is disabled": "文档只读视图已禁用",
  "Edge not found": "未找到连线",
  "Empty file": "文件为空",
  "Failed to save scan config": "保存扫描配置失败",
  "File content does not match its type": "文件内容与其类型不符",
  "File too large (max 10 MB)": "文件过大（上限 10 MB）",
  "Import job not found or expired": "导入任务不存在或已过期",
  "Invalid API key": "API 密钥无效",
  "Invalid MCP service key": "MCP 服务密钥无效",
  "Invalid credentials": "凭据无效",
  "Invalid documentation view key": "文档只读视图密钥无效",
  "Invalid live view key": "实时视图密钥无效",
  "Invalid run_id format": "run_id 格式无效",
  "Invalid token": "令牌无效",
  "Live view is disabled": "实时视图已禁用",
  "Local login is disabled": "本地登录已禁用",
  "MCP service key not configured": "未配置 MCP 服务密钥",
  "No Proxmox API token provided and none configured on the server.": "没有提供 Proxmox API 令牌，服务器上也没有配置",
  "No UniFi credentials provided and none configured on the server.": "没有提供 UniFi 凭据，服务器上也没有配置",
  "Node not found": "未找到节点",
  "Not authenticated": "未认证",
  "Not found": "未找到",
  "OIDC authentication failed": "OIDC 认证失败",
  "OIDC login is disabled": "OIDC 登录已禁用",
  "Provide both Proxmox token fields": "请同时提供 Proxmox 令牌的两项内容",
  "Rack devices cannot be placed on a logical canvas": "机柜设备不能放在普通画布上",
  "Scan is not running": "扫描未在运行",
  "Scan run not found": "未找到该扫描任务",
  "Select at least two devices to merge": "至少选择两台设备才能合并",
  "Stats endpoint is disabled": "统计接口已禁用",
  "The server-configured Proxmox token requires TLS verification": "服务器配置的 Proxmox 令牌需要开启 TLS 校验",
  "Unexpected error during Proxmox import": "Proxmox 导入过程中发生意外错误",
  "Unexpected error during UniFi import": "UniFi 导入过程中发生意外错误",
  "Unexpected error during Z-Wave import": "Z-Wave 导入过程中发生意外错误",
  // Reworded upstream in 52765a4 ("– PNG, JPEG, or WebP only" gained SVG and
  // PDF along with the upload routes). The backend stays the authority, so the
  // key tracks whatever the server actually sends.
  "Unsupported media type — PNG, JPEG, WebP, SVG or PDF only": "不支持的媒体类型 —— 仅支持 PNG、JPEG、WebP、SVG 或 PDF",
}

export default part

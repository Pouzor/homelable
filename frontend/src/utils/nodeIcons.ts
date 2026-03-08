import {
  // Infrastructure (node types)
  Globe, Router, Network, Server, Layers, Box, Container, HardDrive, Cpu, Wifi, Circle,
  // Media
  Play, Film, Tv, Tv2, Music, Camera, Video, Headphones, Clapperboard, Cctv,
  // Monitoring & Observability
  Activity, BarChart2, LineChart, Eye, Bell, Gauge, Monitor,
  // Storage & Databases
  Database, Archive, Cloud, FolderOpen,
  // Security & Auth
  Shield, ShieldCheck, Lock, Key, Users, UserCheck,
  // Automation & IoT
  Zap, Workflow, Bot, Home, Thermometer, Lightbulb, Radio,
  // Transfers & sync
  Download, Upload, RefreshCw,
  // Containers & Dev
  Anchor, GitBranch, Terminal, Code2, Settings,
  // Communications
  Mail, MessageSquare, Phone,
  // Misc devices
  Printer, Smartphone, Search, Filter, BookOpen,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export interface IconEntry {
  key: string
  label: string
  category: string
  icon: LucideIcon
}

export const ICON_REGISTRY: IconEntry[] = [
  // --- Infrastructure ---
  { key: 'globe',      label: 'Globe / ISP',       category: 'Infrastructure', icon: Globe },
  { key: 'router',     label: 'Router',             category: 'Infrastructure', icon: Router },
  { key: 'network',    label: 'Switch / Network',   category: 'Infrastructure', icon: Network },
  { key: 'server',     label: 'Server',             category: 'Infrastructure', icon: Server },
  { key: 'layers',     label: 'Proxmox / Hypervisor', category: 'Infrastructure', icon: Layers },
  { key: 'box',        label: 'VM',                 category: 'Infrastructure', icon: Box },
  { key: 'container',  label: 'Container / LXC',    category: 'Infrastructure', icon: Container },
  { key: 'harddrive',  label: 'NAS / Storage',      category: 'Infrastructure', icon: HardDrive },
  { key: 'cpu',        label: 'IoT / Embedded',     category: 'Infrastructure', icon: Cpu },
  { key: 'wifi',       label: 'Access Point',       category: 'Infrastructure', icon: Wifi },
  { key: 'circle',     label: 'Generic',            category: 'Infrastructure', icon: Circle },
  { key: 'monitor',    label: 'Workstation',        category: 'Infrastructure', icon: Monitor },
  { key: 'smartphone', label: 'Phone / Mobile',     category: 'Infrastructure', icon: Smartphone },
  { key: 'printer',    label: 'Printer',            category: 'Infrastructure', icon: Printer },

  // --- Media ---
  { key: 'play',         label: 'Jellyfin / Emby',   category: 'Media', icon: Play },
  { key: 'tv2',          label: 'Plex',              category: 'Media', icon: Tv2 },
  { key: 'film',         label: 'Sonarr / Movies',   category: 'Media', icon: Film },
  { key: 'clapperboard', label: 'Radarr',            category: 'Media', icon: Clapperboard },
  { key: 'music',        label: 'Lidarr / Music',    category: 'Media', icon: Music },
  { key: 'book',         label: 'Readarr / Books',   category: 'Media', icon: BookOpen },
  { key: 'tv',           label: 'IPTV / Live TV',    category: 'Media', icon: Tv },
  { key: 'headphones',   label: 'Audiobookshelf',    category: 'Media', icon: Headphones },
  { key: 'video',        label: 'Video / Streaming', category: 'Media', icon: Video },
  { key: 'camera',       label: 'Camera / Frigate',  category: 'Media', icon: Camera },
  { key: 'cctv',         label: 'CCTV / IP Camera',  category: 'Media', icon: Cctv },

  // --- Monitoring ---
  { key: 'activity',   label: 'Prometheus / Uptime', category: 'Monitoring', icon: Activity },
  { key: 'barchart',   label: 'Grafana / Kibana',   category: 'Monitoring', icon: BarChart2 },
  { key: 'linechart',  label: 'InfluxDB / Metrics', category: 'Monitoring', icon: LineChart },
  { key: 'eye',        label: 'Overseerr / Watchlist', category: 'Monitoring', icon: Eye },
  { key: 'bell',       label: 'Alerts / Notifiarr', category: 'Monitoring', icon: Bell },
  { key: 'gauge',      label: 'Dashboard / Status', category: 'Monitoring', icon: Gauge },

  // --- Storage & Databases ---
  { key: 'database',   label: 'Database (SQL/NoSQL)', category: 'Storage', icon: Database },
  { key: 'archive',    label: 'Backup / Archive',    category: 'Storage', icon: Archive },
  { key: 'cloud',      label: 'Nextcloud / S3',      category: 'Storage', icon: Cloud },
  { key: 'folder',     label: 'Files / Filebrowser', category: 'Storage', icon: FolderOpen },
  { key: 'download',   label: 'Downloader (Torrent/NZB)', category: 'Storage', icon: Download },
  { key: 'upload',     label: 'Upload / Sync',       category: 'Storage', icon: Upload },
  { key: 'refresh',    label: 'Sync / Resilio',      category: 'Storage', icon: RefreshCw },

  // --- Security & Auth ---
  { key: 'shield',      label: 'Pi-hole / DNS Block', category: 'Security', icon: Shield },
  { key: 'shieldcheck', label: 'AdGuard Home',        category: 'Security', icon: ShieldCheck },
  { key: 'lock',        label: 'Authelia / Authentik', category: 'Security', icon: Lock },
  { key: 'key',         label: 'Vaultwarden / Vault', category: 'Security', icon: Key },
  { key: 'users',       label: 'LDAP / SSO',          category: 'Security', icon: Users },
  { key: 'usercheck',   label: 'Keycloak',            category: 'Security', icon: UserCheck },
  { key: 'filter',      label: 'Prowlarr / Jackett',  category: 'Security', icon: Filter },
  { key: 'search',      label: 'Search / Indexer',    category: 'Security', icon: Search },

  // --- Automation & Smart Home ---
  { key: 'home',        label: 'Home Assistant',      category: 'Automation', icon: Home },
  { key: 'zap',         label: 'ESPHome / Node-RED',  category: 'Automation', icon: Zap },
  { key: 'workflow',    label: 'n8n / Node-RED',      category: 'Automation', icon: Workflow },
  { key: 'bot',         label: 'Bot / Automation',    category: 'Automation', icon: Bot },
  { key: 'thermometer', label: 'Sensor / Temperature', category: 'Automation', icon: Thermometer },
  { key: 'lightbulb',  label: 'Smart Light / Zigbee', category: 'Automation', icon: Lightbulb },
  { key: 'radio',      label: 'MQTT / RTL-SDR',       category: 'Automation', icon: Radio },

  // --- Containers & Dev ---
  { key: 'anchor',    label: 'Portainer / Docker',   category: 'Dev & Containers', icon: Anchor },
  { key: 'gitbranch', label: 'Gitea / Gitlab',       category: 'Dev & Containers', icon: GitBranch },
  { key: 'terminal',  label: 'SSH / Shell',          category: 'Dev & Containers', icon: Terminal },
  { key: 'code',      label: 'VS Code Server',       category: 'Dev & Containers', icon: Code2 },
  { key: 'settings',  label: 'Config / Admin',       category: 'Dev & Containers', icon: Settings },

  // --- Communications ---
  { key: 'mail',    label: 'Mail Server',         category: 'Communications', icon: Mail },
  { key: 'chat',    label: 'Chat / Synapse',      category: 'Communications', icon: MessageSquare },
  { key: 'phone',   label: 'VoIP / FreePBX',      category: 'Communications', icon: Phone },
]

export const ICON_CATEGORIES = [...new Set(ICON_REGISTRY.map((e) => e.category))]

export const ICON_MAP: Record<string, LucideIcon> = Object.fromEntries(
  ICON_REGISTRY.map((e) => [e.key, e.icon]),
)

/** Resolve the display icon for a node — custom_icon takes priority over type default. */
export function resolveNodeIcon(
  typeIcon: LucideIcon,
  customIconKey?: string,
): LucideIcon {
  if (customIconKey && ICON_MAP[customIconKey]) return ICON_MAP[customIconKey]
  return typeIcon
}

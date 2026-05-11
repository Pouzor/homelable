import type { NodeType } from '@/types'
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
  Shield, ShieldCheck, Lock, Key, Users, UserCheck, Flame,
  // Automation & IoT
  Zap, Workflow, Bot, Home, Thermometer, Lightbulb, Radio, BotMessageSquare, Webhook,
  // Smart Home / Sensors
  Plug, Power, BatteryCharging, Sun, DoorOpen, KeyRound, AlarmSmoke, Siren,
  Radar, PersonStanding, Vibrate, Droplet, Droplets, Wind, AirVent, Fan,
  Snowflake, LampCeiling, Blinds, BellRing, Speaker, Joystick, Warehouse,
  CircleDot, CloudSun,
  // Transfers & sync
  Download, Upload, RefreshCw,
  // Containers & Dev
  Anchor, Package, GitBranch, Terminal, Code2, Settings,
  // Communications
  Mail, MessageSquare, Phone,
  // Misc devices
  Printer, Smartphone, Search, Filter, BookOpen, PlugZap, Type,
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
  { key: 'globe',      label: 'Globe / ISP',          category: 'Infrastructure', icon: Globe },
  { key: 'router',     label: 'Router',               category: 'Infrastructure', icon: Router },
  { key: 'flame',      label: 'Firewall',             category: 'Infrastructure', icon: Flame },
  { key: 'network',    label: 'Switch / Network',     category: 'Infrastructure', icon: Network },
  { key: 'server',     label: 'Server',               category: 'Infrastructure', icon: Server },
  { key: 'layers',     label: 'Proxmox / Hypervisor', category: 'Infrastructure', icon: Layers },
  { key: 'box',        label: 'VM',                   category: 'Infrastructure', icon: Box },
  { key: 'container',  label: 'Container / LXC',      category: 'Infrastructure', icon: Container },
  { key: 'harddrive',  label: 'NAS / Storage',        category: 'Infrastructure', icon: HardDrive },
  { key: 'cpu',        label: 'IoT / Embedded',       category: 'Infrastructure', icon: Cpu },
  { key: 'wifi',       label: 'Access Point',         category: 'Infrastructure', icon: Wifi },
  { key: 'circle',     label: 'Generic',              category: 'Infrastructure', icon: Circle },
  { key: 'monitor',    label: 'Workstation',          category: 'Infrastructure', icon: Monitor },
  { key: 'smartphone', label: 'Phone / Mobile',       category: 'Infrastructure', icon: Smartphone },
  { key: 'printer',    label: 'Printer',              category: 'Infrastructure', icon: Printer },
  { key: 'plugzap',    label: 'CPL / Powerline',      category: 'Infrastructure', icon: PlugZap },

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
  { key: 'activity',   label: 'Prometheus / Uptime',   category: 'Monitoring', icon: Activity },
  { key: 'barchart',   label: 'Grafana / Kibana',      category: 'Monitoring', icon: BarChart2 },
  { key: 'linechart',  label: 'InfluxDB / Metrics',    category: 'Monitoring', icon: LineChart },
  { key: 'eye',        label: 'Overseerr / Watchlist', category: 'Monitoring', icon: Eye },
  { key: 'bell',       label: 'Alerts / Notifiarr',    category: 'Monitoring', icon: Bell },
  { key: 'gauge',      label: 'Dashboard / Status',    category: 'Monitoring', icon: Gauge },

  // --- Storage & Databases ---
  { key: 'database',   label: 'Database (SQL/NoSQL)',     category: 'Storage', icon: Database },
  { key: 'archive',    label: 'Backup / Archive',         category: 'Storage', icon: Archive },
  { key: 'cloud',      label: 'Nextcloud / S3',           category: 'Storage', icon: Cloud },
  { key: 'folder',     label: 'Files / Filebrowser',      category: 'Storage', icon: FolderOpen },
  { key: 'download',   label: 'Downloader (Torrent/NZB)', category: 'Storage', icon: Download },
  { key: 'upload',     label: 'Upload / Sync',            category: 'Storage', icon: Upload },
  { key: 'refresh',    label: 'Sync / Resilio',           category: 'Storage', icon: RefreshCw },

  // --- Security & Auth ---
  { key: 'shield',      label: 'Pi-hole / DNS Block',  category: 'Security', icon: Shield },
  { key: 'shieldcheck', label: 'AdGuard Home',         category: 'Security', icon: ShieldCheck },
  { key: 'lock',        label: 'Authelia / Authentik', category: 'Security', icon: Lock },
  { key: 'key',         label: 'Vaultwarden / Vault',  category: 'Security', icon: Key },
  { key: 'users',       label: 'LDAP / SSO',           category: 'Security', icon: Users },
  { key: 'usercheck',   label: 'Keycloak',             category: 'Security', icon: UserCheck },
  { key: 'filter',      label: 'Prowlarr / Jackett',   category: 'Security', icon: Filter },
  { key: 'search',      label: 'Search / Indexer',     category: 'Security', icon: Search },

  // --- Automation & Smart Home ---
  { key: 'home',        label: 'Home Assistant',       category: 'Automation', icon: Home },
  { key: 'zap',         label: 'ESPHome / Node-RED',   category: 'Automation', icon: Zap },
  { key: 'workflow',    label: 'n8n / Node-RED',       category: 'Automation', icon: Workflow },
  { key: 'bot',         label: 'Bot / Automation',     category: 'Automation', icon: Bot },
  { key: 'thermometer', label: 'Sensor / Temperature', category: 'Automation', icon: Thermometer },
  { key: 'lightbulb',   label: 'Smart Light / Zigbee', category: 'Automation', icon: Lightbulb },
  { key: 'radio',       label: 'MQTT / RTL-SDR',       category: 'Automation', icon: Radio },
  { key: 'voice',       label: 'Voice Assistant',      category: 'Automation', icon: BotMessageSquare },
  { key: 'webhook',     label: 'Webhook / IFTTT',      category: 'Automation', icon: Webhook },

  // --- Smart Home / Sensors ---
  { key: 'plug',             label: 'Smart Plug / Outlet',  category: 'Smart Home / Sensors', icon: Plug },
  { key: 'power',            label: 'Switch / Relay',       category: 'Smart Home / Sensors', icon: Power },
  { key: 'battery-charging', label: 'Energy Meter / EV',    category: 'Smart Home / Sensors', icon: BatteryCharging },
  { key: 'solar',            label: 'Solar Panel',          category: 'Smart Home / Sensors', icon: Sun },
  { key: 'door',             label: 'Door / Window Sensor', category: 'Smart Home / Sensors', icon: DoorOpen },
  { key: 'lock-smart',       label: 'Smart Lock',           category: 'Smart Home / Sensors', icon: KeyRound },
  { key: 'smoke',            label: 'Smoke Detector',       category: 'Smart Home / Sensors', icon: AlarmSmoke },
  { key: 'siren',            label: 'Siren / Alarm',        category: 'Smart Home / Sensors', icon: Siren },
  { key: 'motion',           label: 'Motion / Radar',       category: 'Smart Home / Sensors', icon: Radar },
  { key: 'presence',         label: 'Presence Sensor',      category: 'Smart Home / Sensors', icon: PersonStanding },
  { key: 'vibration',        label: 'Vibration Sensor',     category: 'Smart Home / Sensors', icon: Vibrate },
  { key: 'leak',             label: 'Water Leak',           category: 'Smart Home / Sensors', icon: Droplet },
  { key: 'humidity',         label: 'Humidity',             category: 'Smart Home / Sensors', icon: Droplets },
  { key: 'air-quality',      label: 'Air Quality / VOC',    category: 'Smart Home / Sensors', icon: Wind },
  { key: 'air-vent',         label: 'HVAC Vent',            category: 'Smart Home / Sensors', icon: AirVent },
  { key: 'fan',              label: 'Fan',                  category: 'Smart Home / Sensors', icon: Fan },
  { key: 'snowflake',        label: 'AC / Cooling',         category: 'Smart Home / Sensors', icon: Snowflake },
  { key: 'lamp',             label: 'Smart Light',          category: 'Smart Home / Sensors', icon: LampCeiling },
  { key: 'blinds',           label: 'Blinds / Cover',       category: 'Smart Home / Sensors', icon: Blinds },
  { key: 'doorbell',         label: 'Doorbell',             category: 'Smart Home / Sensors', icon: BellRing },
  { key: 'speaker',          label: 'Smart Speaker',        category: 'Smart Home / Sensors', icon: Speaker },
  { key: 'remote',           label: 'Remote / Button',      category: 'Smart Home / Sensors', icon: Joystick },
  { key: 'garage',           label: 'Garage Door',          category: 'Smart Home / Sensors', icon: Warehouse },
  { key: 'valve',            label: 'Smart Valve',          category: 'Smart Home / Sensors', icon: CircleDot },
  { key: 'weather',          label: 'Weather Station',      category: 'Smart Home / Sensors', icon: CloudSun },

  // --- Containers & Dev ---
  { key: 'anchor',    label: 'Portainer / Docker',        category: 'Dev & Containers', icon: Anchor },
  { key: 'package',   label: 'Docker Host / Container',  category: 'Dev & Containers', icon: Package },
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

export const NODE_TYPE_DEFAULT_ICONS: Record<NodeType, LucideIcon> = {
  isp:          Globe,
  router:       Router,
  firewall:     Flame,
  switch:       Network,
  server:       Server,
  proxmox:      Layers,
  vm:           Box,
  lxc:          Container,
  nas:          HardDrive,
  iot:          Cpu,
  ap:           Wifi,
  camera:       Cctv,
  printer:      Printer,
  computer:     Monitor,
  cpl:          PlugZap,
  docker_host:       Anchor,
  docker_container:  Package,
  zigbee_coordinator: Radio,
  zigbee_router:      Zap,
  zigbee_enddevice:   Lightbulb,
  generic:           Circle,
  group:        Circle,
  groupRect:    Circle,
  text:         Type,
}

/** Resolve the display icon for a node — custom_icon takes priority over type default.
 *  Legacy: returns a LucideIcon component. Brand icons must use `resolveCustomIcon`. */
export function resolveNodeIcon(
  typeIcon: LucideIcon,
  customIconKey?: string,
): LucideIcon {
  if (customIconKey && !customIconKey.startsWith('brand:') && ICON_MAP[customIconKey]) {
    return ICON_MAP[customIconKey]
  }
  return typeIcon
}

export const BRAND_ICON_PREFIX = 'brand:'

export function isBrandIconKey(key: string | undefined | null): boolean {
  return !!key && key.startsWith(BRAND_ICON_PREFIX)
}

export function brandIconSlug(key: string): string {
  return key.slice(BRAND_ICON_PREFIX.length)
}

export function brandIconUrl(slug: string): string {
  return `https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/${slug}.svg`
}

export type ResolvedIcon =
  | { kind: 'lucide'; icon: LucideIcon }
  | { kind: 'brand'; slug: string; url: string }

/** Resolve a node's icon to either a lucide component or a brand CDN URL.
 *  Used by renderers that support brand icons. Backwards-compatible with legacy
 *  string keys (no prefix → lucide lookup). Returns null when key unknown. */
export function resolveCustomIcon(customIconKey?: string): ResolvedIcon | null {
  if (!customIconKey) return null
  if (isBrandIconKey(customIconKey)) {
    const slug = brandIconSlug(customIconKey)
    return { kind: 'brand', slug, url: brandIconUrl(slug) }
  }
<<<<<<< HEAD
  const icon = ICON_MAP[customIconKey] as LucideIcon | undefined
=======
  const icon = ICON_MAP[customIconKey]
>>>>>>> e30a243 (feat(icons): add brand icon picker from dashboard-icons)
  return icon ? { kind: 'lucide', icon } : null
}

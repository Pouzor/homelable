import {
  LayoutDashboard, Zap, Network, Server, HardDrive, Cpu, Wifi, Router,
  Database, Cloud, Home, Globe, Lightbulb, Factory, Plug, Boxes,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export interface DesignIconEntry {
  key: string
  label: string
  icon: LucideIcon
}

/** Curated icon set offered when creating/editing a canvas design. Keys are
 *  stable strings persisted on `Design.icon`. */
export const DESIGN_ICONS: DesignIconEntry[] = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { key: 'network', label: 'Network', icon: Network },
  { key: 'zap', label: 'Electrical', icon: Zap },
  { key: 'server', label: 'Server', icon: Server },
  { key: 'harddrive', label: 'Storage', icon: HardDrive },
  { key: 'cpu', label: 'Compute', icon: Cpu },
  { key: 'wifi', label: 'Wireless', icon: Wifi },
  { key: 'router', label: 'Router', icon: Router },
  { key: 'database', label: 'Database', icon: Database },
  { key: 'cloud', label: 'Cloud', icon: Cloud },
  { key: 'home', label: 'Home', icon: Home },
  { key: 'globe', label: 'Internet', icon: Globe },
  { key: 'lightbulb', label: 'Lighting', icon: Lightbulb },
  { key: 'factory', label: 'Industrial', icon: Factory },
  { key: 'plug', label: 'Power', icon: Plug },
  { key: 'boxes', label: 'Cluster', icon: Boxes },
]

export const DEFAULT_DESIGN_ICON = 'dashboard'

const ICON_MAP: Record<string, LucideIcon> = Object.fromEntries(
  DESIGN_ICONS.map((e) => [e.key, e.icon]),
)

/** Resolve a persisted design icon key to a lucide component. Unknown/empty
 *  keys fall back to the dashboard icon so the UI never breaks on legacy data. */
export function resolveDesignIcon(key?: string | null): LucideIcon {
  return (key && ICON_MAP[key]) || LayoutDashboard
}

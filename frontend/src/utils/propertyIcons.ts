import {
  Battery,
  Box,
  Clock,
  Cpu,
  Database,
  Globe,
  HardDrive,
  Hash,
  Key,
  Layers,
  Link,
  MemoryStick,
  Monitor,
  Network,
  Server,
  Shield,
  Tag,
  Thermometer,
  Wifi,
  Zap,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export const PROPERTY_ICONS: Record<string, LucideIcon> = {
  Battery,
  Box,
  Clock,
  Cpu,
  Database,
  Globe,
  HardDrive,
  Hash,
  Key,
  Layers,
  Link,
  MemoryStick,
  Monitor,
  Network,
  Server,
  Shield,
  Tag,
  Thermometer,
  Wifi,
  Zap,
}

export const PROPERTY_ICON_NAMES = Object.keys(PROPERTY_ICONS) as (keyof typeof PROPERTY_ICONS)[]

export function resolvePropertyIcon(name: string | null | undefined): LucideIcon | null {
  if (!name) return null
  return PROPERTY_ICONS[name] ?? null
}

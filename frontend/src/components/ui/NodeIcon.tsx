import { createElement } from 'react'
import type { LucideIcon } from 'lucide-react'
import { resolveCustomIcon, brandIconUrl, isBrandIconKey } from '@/utils/nodeIcons'

interface NodeIconProps {
  /** Default icon for the node type (lucide). Used when no customIconKey or unknown key. */
  typeIcon: LucideIcon
  /** Optional override key. Legacy lucide keys or `brand:<slug>` for dashboard-icons. */
  customIconKey?: string
  size?: number
  className?: string
  /** Optional inline color (lucide only — ignored for brand icons). */
  color?: string
}

export function NodeIcon({ typeIcon, customIconKey, size = 16, className, color }: NodeIconProps) {
  const resolved = resolveCustomIcon(customIconKey)
  if (resolved?.kind === 'brand') {
    return (
      <img
        src={resolved.url}
        alt={resolved.slug}
        width={size}
        height={size}
        loading="lazy"
        className={className}
        style={{ width: size, height: size, objectFit: 'contain' }}
      />
    )
  }
  const Icon = resolved?.kind === 'lucide' ? resolved.icon : typeIcon
  return createElement(Icon, { size, className, color })
}

export { brandIconUrl, isBrandIconKey }

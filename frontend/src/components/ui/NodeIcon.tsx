import { createElement } from 'react'
import type { LucideIcon } from 'lucide-react'
import { resolveCustomIcon, brandIconUrl, isBrandIconKey } from '@/utils/nodeIcons'
import { IconImage } from './IconImage'

interface NodeIconProps {
  /** Default icon for the node type (lucide). Used when no customIconKey or unknown key. */
  typeIcon: LucideIcon
  /** Optional override key. Legacy lucide keys, `brand:<slug>` for dashboard-icons, or `url:<link>`. */
  customIconKey?: string
  size?: number
  className?: string
  /** Optional inline color (lucide only — ignored for image icons). */
  color?: string
}

export function NodeIcon({ typeIcon, customIconKey, size = 16, className, color }: NodeIconProps) {
  const resolved = resolveCustomIcon(customIconKey)
  if (resolved?.kind === 'brand' || resolved?.kind === 'url') {
    return (
      <IconImage
        src={resolved.url}
        alt={resolved.kind === 'brand' ? resolved.slug : resolved.label}
        size={size}
        className={className}
        fallback={createElement(typeIcon, { size, className, color })}
      />
    )
  }
  const Icon = resolved?.kind === 'lucide' ? resolved.icon : typeIcon
  return createElement(Icon, { size, className, color })
}

export { brandIconUrl, isBrandIconKey }

import { createElement } from 'react'
import { resolveCustomIcon } from '@/utils/nodeIcons'
import { IconImage } from './IconImage'

interface ServiceIconProps {
  /** Icon key on the service — a lucide registry key, `brand:<slug>` or `url:<link>`. */
  iconKey?: string
  size?: number
  className?: string
  color?: string
}

/**
 * Renders a service's icon, or nothing when the service has no icon (or carries
 * a key we can't resolve — e.g. a legacy scanner signature name).
 */
export function ServiceIcon({ iconKey, size = 12, className, color }: ServiceIconProps) {
  const resolved = resolveCustomIcon(iconKey)
  if (!resolved) return null
  if (resolved.kind === 'brand' || resolved.kind === 'url') {
    return (
      <IconImage
        src={resolved.url}
        alt={resolved.kind === 'brand' ? resolved.slug : resolved.label}
        size={size}
        className={className}
        style={{ flexShrink: 0 }}
      />
    )
  }
  return createElement(resolved.icon, { size, className, color })
}

import { createElement } from 'react'
import { resolveCustomIcon } from '@/utils/nodeIcons'

interface ServiceIconProps {
  /** Icon key on the service — a lucide registry key or `brand:<slug>`. */
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
  if (resolved.kind === 'brand') {
    return (
      <img
        src={resolved.url}
        alt={resolved.slug}
        width={size}
        height={size}
        loading="lazy"
        className={className}
        style={{ width: size, height: size, objectFit: 'contain', flexShrink: 0 }}
      />
    )
  }
  return createElement(resolved.icon, { size, className, color })
}

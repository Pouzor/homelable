import { createElement, useEffect, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import { resolveCustomIcon, brandIconUrl, isBrandIconKey } from '@/utils/nodeIcons'

interface NodeIconProps {
  /** Default icon for the node type (lucide). Used when no customIconKey or unknown key. */
  typeIcon: LucideIcon
  /** Optional override key. Supports: lucide key, `brand:slug`, `mdi:name[:#color]`,
   *  `si:name[:#color]`, `sh:name[.ext]`, `https://...`, `/icons/...`. */
  customIconKey?: string
  size?: number
  className?: string
  /** Optional inline color (lucide only — ignored for brand/url icons). */
  color?: string
}

/**
 * Fetches an SVG URL, injects a fill color (or `currentColor`), and returns the
 * modified markup. Used for MDI and Simple Icons that need tinting.
 */
function useColoredSvg(url: string, color: string | undefined, size: number): string | null {
  const [svgHtml, setSvgHtml] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setSvgHtml(null)
    fetch(url)
      .then((r) => (r.ok ? r.text() : Promise.reject()))
      .then((text) => {
        if (cancelled) return
        const fill = color ?? 'currentColor'
        // Remove existing width/height/fill on root <svg> and inject our values
        const html = text.replace(/(<svg\b)([^>]*)(>)/, (_, open, attrs, close) => {
          const cleaned = attrs
            .replace(/\s+(width|height|fill)="[^"]*"/g, '')
          return `${open}${cleaned} fill="${fill}" width="${size}" height="${size}"${close}`
        })
        setSvgHtml(html)
      })
      .catch(() => {
        if (!cancelled) setSvgHtml(null)
      })
    return () => { cancelled = true }
  }, [url, color, size])

  return svgHtml
}

/** Render an SVG loaded from a URL with optional color injection. Shows a plain <img>
 *  as a loading placeholder while the fetch is in flight. */
function ColoredSvgIcon({
  url,
  color,
  size,
  className,
  alt,
}: { url: string; color?: string; size: number; className?: string; alt: string }) {
  const svgHtml = useColoredSvg(url, color, size)
  if (svgHtml) {
    return (
      <span
        className={className}
        style={{ width: size, height: size, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
        // SVG comes from trusted CDNs (jsDelivr serving known open-source repos)
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: svgHtml }}
      />
    )
  }
  return (
    <img
      src={url}
      alt={alt}
      width={size}
      height={size}
      loading="lazy"
      className={className}
      style={{ width: size, height: size, objectFit: 'contain' }}
    />
  )
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

  // MDI — always render inline SVG so currentColor/tint works on dark backgrounds
  if (resolved?.kind === 'mdi') {
    return (
      <ColoredSvgIcon
        url={resolved.url}
        color={resolved.color}
        size={size}
        className={className}
        alt={resolved.name}
      />
    )
  }

  // Simple Icons — inline SVG only when custom color requested; native color otherwise
  if (resolved?.kind === 'si') {
    if (resolved.color) {
      return (
        <ColoredSvgIcon
          url={resolved.url}
          color={resolved.color}
          size={size}
          className={className}
          alt={resolved.name}
        />
      )
    }
    return (
      <img
        src={resolved.url}
        alt={resolved.name}
        width={size}
        height={size}
        loading="lazy"
        className={className}
        style={{ width: size, height: size, objectFit: 'contain' }}
      />
    )
  }

  // selfh.st and remote/local URLs — plain <img>
  if (resolved?.kind === 'sh' || resolved?.kind === 'url') {
    const alt = resolved.kind === 'sh' ? resolved.name : 'icon'
    return (
      <img
        src={resolved.url}
        alt={alt}
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

import { useState, type CSSProperties, type ReactNode } from 'react'

interface IconImageProps {
  src: string
  alt: string
  size: number
  className?: string
  style?: CSSProperties
  /** Rendered instead of the image once it fails to load (dead link, offline CDN). */
  fallback?: ReactNode
}

/**
 * An image icon (brand CDN or custom `url:` link). A link that fails to load
 * swaps to `fallback` rather than leaving a broken-image glyph on the canvas.
 */
export function IconImage({ src, alt, size, className, style, fallback = null }: IconImageProps) {
  // Remember which src failed, so a new src gets its own chance to load.
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  if (failedSrc === src) return <>{fallback}</>
  return (
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      loading="lazy"
      referrerPolicy="no-referrer"
      className={className}
      style={{ width: size, height: size, objectFit: 'contain', ...style }}
      onError={() => setFailedSrc(src)}
    />
  )
}

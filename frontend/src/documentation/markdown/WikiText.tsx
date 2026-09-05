import { Children, isValidElement, type ReactNode } from 'react'

import { resolveWikiLink, splitWikiLinks, type LinkableDevice, type LinkableDoc } from '../wikilinks'

/**
 * Rewrites `[[…]]` inside already-rendered markdown children.
 *
 * Walking the rendered children rather than the markdown source keeps the
 * wiki-link syntax out of the AST pipeline, so emphasis, code spans and links
 * around it still parse as ordinary markdown.
 */

interface Props {
  children: ReactNode
  docs: LinkableDoc[]
  devices: LinkableDevice[]
  onOpenDoc?: (docId: string) => void
  onCreate?: (label: string) => void
}

export function WikiText({ children, docs, devices, onOpenDoc, onCreate }: Props) {
  return (
    <>
      {Children.map(children, (child, childIndex) => {
        if (typeof child !== 'string') {
          // Only bare text can carry a wiki-link; anything already rendered
          // (a code span, a link) is left exactly as markdown produced it.
          return isValidElement(child) ? child : child
        }
        return splitWikiLinks(child).map((segment, index) => {
          if (segment.type === 'text') return segment.value
          const targetId = resolveWikiLink(segment.link, docs, devices)
          const key = `${childIndex}-${index}`
          if (!targetId) {
            return (
              <button
                key={key}
                type="button"
                onClick={() => onCreate?.(segment.link.label)}
                title="No document matches this link yet — click to create one"
                className="cursor-pointer rounded border border-dashed border-destructive/50 px-1 text-destructive"
              >
                {segment.link.label}
              </button>
            )
          }
          return (
            <button
              key={key}
              type="button"
              onClick={() => onOpenDoc?.(targetId)}
              className="cursor-pointer rounded bg-primary/10 px-1 text-primary hover:bg-primary/20"
            >
              {segment.link.label}
            </button>
          )
        })
      })}
    </>
  )
}

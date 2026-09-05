import { useMemo } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import rehypeSlug from 'rehype-slug'
import remarkGfm from 'remark-gfm'

import { parseFrontmatter } from '../frontmatter'
import { toggleTaskAtLine } from './tasks'
import { WikiText } from './WikiText'
import type { LinkableDevice, LinkableDoc } from '../wikilinks'

/**
 * Renders a document body.
 *
 * Raw HTML is deliberately **not** enabled (`rehype-raw` is absent), so a
 * document cannot inject markup and no sanitiser is needed. The HTML comments
 * the generator writes as provenance markers simply do not render, which is
 * what we want: they stay in the source and out of the page.
 */

export interface MarkdownProps {
  body: string
  docs?: LinkableDoc[]
  devices?: LinkableDevice[]
  onOpenDoc?: (docId: string) => void
  onCreateFromLink?: (label: string) => void
  /** Called when a task checkbox is toggled, with the rewritten body. */
  onToggleTask?: (nextBody: string) => void
  className?: string
}

export function Markdown({
  body,
  docs = [],
  devices = [],
  onOpenDoc,
  onCreateFromLink,
  onToggleTask,
  className,
}: MarkdownProps) {
  const { content } = useMemo(() => parseFrontmatter(body), [body])

  const components = useMemo<Components>(() => {
    return {
      // Every text node passes through the wiki-link splitter.
      p: ({ children }) => (
        <p className="my-3 leading-relaxed">
          <WikiText docs={docs} devices={devices} onOpenDoc={onOpenDoc} onCreate={onCreateFromLink}>
            {children}
          </WikiText>
        </p>
      ),
      li: ({ children }) => (
        <li className="my-1">
          <WikiText docs={docs} devices={devices} onOpenDoc={onOpenDoc} onCreate={onCreateFromLink}>
            {children}
          </WikiText>
        </li>
      ),
      td: ({ children }) => (
        <td className="border border-border px-3 py-1.5 align-top">
          <WikiText docs={docs} devices={devices} onOpenDoc={onOpenDoc} onCreate={onCreateFromLink}>
            {children}
          </WikiText>
        </td>
      ),
      h1: ({ children, ...props }) => (
        <h1 {...props} className="mt-8 mb-3 scroll-mt-20 text-2xl font-semibold first:mt-0">
          {children}
        </h1>
      ),
      h2: ({ children, ...props }) => (
        <h2 {...props} className="mt-8 mb-3 scroll-mt-20 border-b border-border pb-1.5 text-lg font-semibold">
          {children}
        </h2>
      ),
      h3: ({ children, ...props }) => (
        <h3 {...props} className="mt-6 mb-2 scroll-mt-20 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {children}
        </h3>
      ),
      a: ({ children, href }) => (
        <a
          href={href}
          target={href?.startsWith('http') ? '_blank' : undefined}
          rel="noreferrer"
          className="text-primary underline underline-offset-2 hover:no-underline"
        >
          {children}
        </a>
      ),
      // Wide tables scroll inside their own box; the page never scrolls sideways.
      table: ({ children }) => (
        <div className="my-4 overflow-x-auto">
          <table className="w-full border-collapse text-xs">{children}</table>
        </div>
      ),
      th: ({ children }) => (
        <th className="border border-border bg-muted/40 px-3 py-1.5 text-left font-medium">{children}</th>
      ),
      blockquote: ({ children }) => (
        <blockquote className="my-4 border-l-2 border-primary/50 bg-muted/30 py-1 pl-4 text-muted-foreground">
          {children}
        </blockquote>
      ),
      code: ({ children, className: cls }) =>
        cls?.includes('language-') ? (
          <code className="font-mono text-xs">{children}</code>
        ) : (
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{children}</code>
        ),
      pre: ({ children }) => (
        <pre className="my-4 overflow-x-auto rounded-lg border border-border bg-muted/40 p-3">{children}</pre>
      ),
      hr: () => <hr className="my-6 border-border" />,
      ul: ({ children }) => <ul className="my-3 list-disc pl-5">{children}</ul>,
      ol: ({ children }) => <ol className="my-3 list-decimal pl-5">{children}</ol>,
      img: ({ src, alt }) => (
        <img src={typeof src === 'string' ? src : undefined} alt={alt ?? ''} className="my-4 max-w-full rounded-lg border border-border" />
      ),
      // The node carries its source position, so a click edits the line that
      // produced it — no counting, and nesting cannot shift the target.
      input: ({ checked, type, node }) => {
        if (type !== 'checkbox') return null
        const line = node?.position?.start.line
        return (
          <input
            type="checkbox"
            checked={Boolean(checked)}
            disabled={!onToggleTask || line === undefined}
            onChange={() => line !== undefined && onToggleTask?.(toggleTaskAtLine(body, line))}
            className="mr-2 -mb-px align-middle accent-primary"
          />
        )
      },
    }
  }, [body, devices, docs, onCreateFromLink, onOpenDoc, onToggleTask])

  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSlug]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  )
}

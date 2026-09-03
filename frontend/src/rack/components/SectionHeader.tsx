/**
 * The rule the logical canvas' `NodeModal` draws over each block of fields,
 * reused by the rack modal so both editors read the same way.
 *
 * `aside` rides the right end of the rule — a status, a count, anything that
 * belongs to the section rather than to one field inside it.
 */
export function SectionHeader({
  children,
  aside,
}: {
  children: React.ReactNode
  aside?: React.ReactNode
}) {
  return (
    <div
      data-testid="section-header"
      className="flex items-center justify-between gap-2 border-b border-[#30363d] pb-1"
    >
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
        {children}
      </span>
      {aside}
    </div>
  )
}

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
      // Fixed height, so a rule with a button in its `aside` still lines up
      // with the plain one beside it.
      className="flex h-7 items-center justify-between gap-2 border-b border-[#30363d]"
    >
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
        {children}
      </span>
      {aside}
    </div>
  )
}

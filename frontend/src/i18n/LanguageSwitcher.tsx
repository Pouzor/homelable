import { useId } from 'react'
import { LOCALES, LOCALE_LABELS, setLocale, t, useLocale, type Locale } from './index'

interface LanguageSwitcherProps {
  className?: string
  /** Accessible name of the control; also the visible label in Settings. */
  label?: string
  /** Show the label text next to the control instead of only for screen readers. */
  showLabel?: boolean
}

/**
 * Language picker. A native <select> on purpose: it is keyboard- and
 * screen-reader-correct for free, works the same on every browser, and is
 * trivially testable — none of which the custom listbox primitives buy us here.
 */
export function LanguageSwitcher({ className, label, showLabel = false }: LanguageSwitcherProps) {
  const locale = useLocale()
  const generatedId = useId()
  const text = label ?? t('Language')

  return (
    <label className={className} htmlFor={generatedId}>
      {showLabel && <span className="text-xs text-foreground">{text}</span>}
      <select
        id={generatedId}
        aria-label={showLabel ? undefined : text}
        value={locale}
        onChange={(e) => setLocale(e.target.value as Locale)}
        className="cursor-pointer rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {LOCALES.map((id) => (
          <option key={id} value={id}>
            {LOCALE_LABELS[id]}
          </option>
        ))}
      </select>
    </label>
  )
}

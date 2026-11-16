/**
 * Applies the interface theme (themeStore `interfaceTheme`) to <html>.
 *
 * The classes go on the root element because dialogs, selects and toasts
 * portal into <body>, so one class reaches all of them. `index.css` keys the
 * Dark / Light token sets off `.hl-modern` / `.hl-light`; without them the
 * Classic tokens on `:root` apply.
 */
import { resolveInterfaceTheme, useThemeStore, type InterfaceTheme } from '@/stores/themeStore'

export const MODERN_CLASS = 'hl-modern'
export const LIGHT_CLASS = 'hl-light'

export function applyInterfaceTheme(el: HTMLElement, mode: InterfaceTheme, systemDark: boolean): void {
  const resolved = resolveInterfaceTheme(mode, systemDark)
  el.classList.toggle(MODERN_CLASS, resolved !== 'classic')
  el.classList.toggle(LIGHT_CLASS, resolved === 'light')
}

/**
 * Keeps <html> in sync with the store and the OS colour scheme. Call once at
 * boot, before the first render, so the page never flashes the wrong theme.
 * Returns an unsubscribe for tests.
 */
export function installInterfaceTheme(el: HTMLElement = document.documentElement): () => void {
  const sync = () => {
    const { interfaceTheme, systemDark } = useThemeStore.getState()
    applyInterfaceTheme(el, interfaceTheme, systemDark)
  }
  sync()
  const unsubStore = useThemeStore.subscribe(sync)

  let media: MediaQueryList | undefined
  try {
    media = window.matchMedia?.('(prefers-color-scheme: dark)')
  } catch {
    media = undefined
  }
  const onScheme = (e: MediaQueryListEvent) => useThemeStore.getState().setSystemDark(e.matches)
  media?.addEventListener?.('change', onScheme)

  return () => {
    unsubStore()
    media?.removeEventListener?.('change', onScheme)
  }
}

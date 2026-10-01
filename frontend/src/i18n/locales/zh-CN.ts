/**
 * Simplified Chinese translations.
 *
 * Keys are the English source strings used at the call site (`t('Save')`), so a
 * missing key renders the English text rather than blank space — a gap degrades
 * to English instead of breaking the UI. See ../core.ts for the rationale.
 *
 * The dictionary is split into `parts/*` because the translation work was done
 * in parallel by several people, each owning a slice of the UI. Each part is
 * merged in below; a key defined in two parts with different values would be a
 * silent last-one-wins, so the test file asserts all parts agree.
 *
 * Conventions (see GLOSSARY.md for the full term list — follow it, several
 * strings appear in more than one part):
 *   - `{name}` placeholders must be kept; a placeholder may be *dropped* when
 *     Chinese has no use for it (this is how English `{plural}` suffixes, e.g.
 *     `device{plural}`, disappear from the rendered text).
 *   - Keep technical identifiers verbatim: Proxmox, Z-Wave, Zigbee, MQTT, YAML,
 *     IP, MAC, PID, UEFI, API.
 *   - `__tests__/coverage.test.ts` scans the source tree and fails on any key
 *     used in code that is missing here, plus any English literal that reaches a
 *     render site without going through `t()`. `__tests__/i18n.test.tsx` adds the
 *     reverse and cross-part checks. All three must stay green.
 */
import root from './parts/root'
import common from './parts/common'
import componentsModals1 from './parts/components-modals-1'
import componentsModals2 from './parts/components-modals-2'
import componentsPanels from './parts/components-panels'
import componentsIntegrations from './parts/components-integrations'
import documentation from './parts/documentation'
import rack from './parts/rack'
// Tables whose values are handed to t() at the render site rather than written
// as literals — see DYNAMIC_TABLES in __tests__/i18n.test.tsx.
import nodeTypes from './parts/node-types'
import icons from './parts/icons'
import docTemplates from './parts/doc-templates'

const zhCN: Record<string, string> = {
  ...root,
  ...common,
  ...componentsModals1,
  ...componentsModals2,
  ...componentsPanels,
  ...componentsIntegrations,
  ...documentation,
  ...rack,
  ...nodeTypes,
  ...icons,
  ...docTemplates,
  // Owned directly by the switcher component.
  Language: '语言',
}

export default zhCN

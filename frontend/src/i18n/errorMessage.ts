import { t } from './index'

/**
 * Turn a rejected request into a line the reader can act on.
 *
 * FastAPI answers an error with `{ detail: "…" }`. That string is an API
 * contract, not display copy: the backend is upstream code and reworded it on
 * purpose. So the detail is run through `t()` — a message the dictionary knows
 * comes back in Chinese, and one it does not know falls through as the English
 * the server actually sent. A backend rename degrades the wording; it never
 * shows the user a raw key or an empty toast.
 *
 * The caller supplies the fallback for the case where the server said nothing
 * useful: a network failure, a non-JSON body, a detail that is not a string.
 */
export function errorMessage(error: unknown, fallback: string): string {
  const detail = readDetail(error)
  if (typeof detail === 'string' && detail.trim()) return t(detail)
  return t(fallback)
}

function readDetail(error: unknown): unknown {
  if (!error || typeof error !== 'object') return undefined
  const res = (error as { response?: { data?: { detail?: unknown } } }).response
  return res?.data?.detail
}

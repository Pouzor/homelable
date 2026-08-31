/**
 * Polling helper for backend import jobs that answer immediately and finish later.
 *
 * A Zigbee canvas import has to fetch a Z2M networkmap, which on a large mesh
 * takes minutes — longer than the read timeout of any reverse proxy in front of
 * the API. The backend therefore returns a job id and does the work in the
 * background; the client polls short requests until the payload is ready.
 */

export class PollAbortedError extends Error {
  constructor() {
    super('Import polling aborted')
    this.name = 'PollAbortedError'
  }
}

export interface ImportJobState<T> {
  status: string
  result: T | null
}

export interface PollImportJobOptions {
  /** Delay between polls, in ms. */
  intervalMs?: number
  /** Abort the loop (modal closed, component unmounted). */
  signal?: AbortSignal
  /** Injected in tests so no timer actually runs. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
}

const defaultSleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new PollAbortedError())
    }
    if (signal?.aborted) {
      onAbort()
      return
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })

/**
 * Poll `fetchJob` until it reports a terminal status, then resolve its result.
 *
 * A failed job surfaces as a rejected `fetchJob` call (the backend replays the
 * original status code), so errors propagate untouched to the caller. Rejects
 * with `PollAbortedError` if the signal fires, and with a plain Error if the
 * job reports done without a payload.
 */
export async function pollImportJob<T>(
  fetchJob: () => Promise<ImportJobState<T>>,
  { intervalMs = 2000, signal, sleep = defaultSleep }: PollImportJobOptions = {},
): Promise<T> {
  for (;;) {
    if (signal?.aborted) throw new PollAbortedError()

    const job = await fetchJob()
    if (signal?.aborted) throw new PollAbortedError()

    if (job.status !== 'running') {
      if (job.result == null) throw new Error('Import finished without a result')
      return job.result
    }

    await sleep(intervalMs, signal)
  }
}

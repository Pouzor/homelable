import { describe, it, expect, vi } from 'vitest'
import { pollImportJob, PollAbortedError, type ImportJobState } from '../importJobPoll'

interface Payload { device_count: number }

const done = (device_count: number): ImportJobState<Payload> => ({
  status: 'done',
  result: { device_count },
})
const running: ImportJobState<Payload> = { status: 'running', result: null }

/** Resolves instantly so no test waits on a real timer. */
const noSleep = () => Promise.resolve()

describe('pollImportJob', () => {
  it('returns the result when the first poll is already done', async () => {
    const fetchJob = vi.fn().mockResolvedValue(done(2))
    await expect(pollImportJob(fetchJob, { sleep: noSleep })).resolves.toEqual({ device_count: 2 })
    expect(fetchJob).toHaveBeenCalledTimes(1)
  })

  it('keeps polling while the job is running', async () => {
    const fetchJob = vi
      .fn()
      .mockResolvedValueOnce(running)
      .mockResolvedValueOnce(running)
      .mockResolvedValueOnce(done(7))

    await expect(pollImportJob(fetchJob, { sleep: noSleep })).resolves.toEqual({ device_count: 7 })
    expect(fetchJob).toHaveBeenCalledTimes(3)
  })

  it('waits the configured interval between polls', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined)
    const fetchJob = vi.fn().mockResolvedValueOnce(running).mockResolvedValueOnce(done(1))

    await pollImportJob(fetchJob, { intervalMs: 1234, sleep })
    expect(sleep).toHaveBeenCalledTimes(1)
    expect(sleep.mock.calls[0][0]).toBe(1234)
  })

  it('propagates a rejected poll so the caller sees the backend status', async () => {
    const err = Object.assign(new Error('boom'), {
      response: { status: 504, data: { detail: 'Timed out' } },
    })
    const fetchJob = vi.fn().mockResolvedValueOnce(running).mockRejectedValueOnce(err)

    await expect(pollImportJob(fetchJob, { sleep: noSleep })).rejects.toBe(err)
  })

  it('rejects with PollAbortedError when aborted before the first poll', async () => {
    const controller = new AbortController()
    controller.abort()
    const fetchJob = vi.fn().mockResolvedValue(done(1))

    await expect(
      pollImportJob(fetchJob, { signal: controller.signal, sleep: noSleep }),
    ).rejects.toBeInstanceOf(PollAbortedError)
    expect(fetchJob).not.toHaveBeenCalled()
  })

  it('rejects with PollAbortedError when aborted while a poll is in flight', async () => {
    const controller = new AbortController()
    const fetchJob = vi.fn().mockImplementation(async () => {
      controller.abort()
      return running
    })

    await expect(
      pollImportJob(fetchJob, { signal: controller.signal, sleep: noSleep }),
    ).rejects.toBeInstanceOf(PollAbortedError)
    expect(fetchJob).toHaveBeenCalledTimes(1)
  })

  it('rejects when the job reports done with no payload', async () => {
    const fetchJob = vi.fn().mockResolvedValue({ status: 'done', result: null })
    await expect(pollImportJob(fetchJob, { sleep: noSleep })).rejects.toThrow(
      'Import finished without a result',
    )
  })

  it('default sleep resolves after the interval and rejects on abort', async () => {
    vi.useFakeTimers()
    try {
      const fetchJob = vi.fn().mockResolvedValueOnce(running).mockResolvedValueOnce(done(1))
      const promise = pollImportJob(fetchJob, { intervalMs: 50 })
      await vi.advanceTimersByTimeAsync(60)
      await expect(promise).resolves.toEqual({ device_count: 1 })

      const controller = new AbortController()
      const aborting = pollImportJob(
        vi.fn().mockResolvedValue(running),
        { intervalMs: 50, signal: controller.signal },
      )
      await vi.advanceTimersByTimeAsync(1)
      controller.abort()
      await expect(aborting).rejects.toBeInstanceOf(PollAbortedError)
    } finally {
      vi.useRealTimers()
    }
  })
})
